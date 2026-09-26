/**
 * COMMAND HANDLERS — Órdenes.
 * Cada handler es una transacción que:
 *   1. carga y BLOQUEA el agregado (SELECT … FOR UPDATE),
 *   2. verifica invariantes de dominio,
 *   3. muta el write model,
 *   4. agrega el evento de dominio al outbox (misma transacción).
 * Los handlers NO actualizan proyecciones: eso lo hace el proyector de forma asíncrona.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import {
  canApprove, canTransition, errors, reviewPrescription, validatePrescriptionShape,
  type OrderStatus, type PrescriptionInput, type PrescriptionStatus, type UserError,
} from '../domain.js';
import { appendEvent } from '../events.js';
import { getOrCreateActiveCart } from './cart.js';

export interface OrderCommandResult {
  errors: UserError[];
  orderId?: string;
  status?: OrderStatus;
  acceptedAt?: Date;
}

const fail = (...errs: UserError[]) => ({ errors: errs, rollback: true });

// =====================================================================
// placeOrder — carrito → orden, con reserva atómica de inventario
// =====================================================================
export async function placeOrder(patientId: string, input: { prescription?: PrescriptionInput | null }): Promise<OrderCommandResult> {
  return withTransaction<OrderCommandResult>(async (tx) => {
    const cartId = await getOrCreateActiveCart(tx, patientId);

    // Bloquea las filas de medicamentos en orden de id (evita deadlocks entre compras concurrentes).
    const lines = await query<{
      medicationId: number; quantity: number; name: string; price: number; stock: number; requiresPrescription: boolean;
    }>(
      'order.lockCartMedications',
      `SELECT m.id AS "medicationId", ci.quantity, m.name, m.price, m.stock,
              m.requires_prescription AS "requiresPrescription"
         FROM cart_items ci JOIN medications m ON m.id = ci.medication_id
        WHERE ci.cart_id = $1
        ORDER BY m.id
          FOR UPDATE OF m`,
      [cartId],
      tx,
    );
    if (lines.length === 0) return fail(errors.emptyCart());

    // --- Invariante 1: medicamentos con fórmula exigen soporte médico ---
    const rxLines = lines.filter((l) => l.requiresPrescription);
    const prescription = input.prescription ?? null;
    if (rxLines.length > 0 && !prescription) {
      return fail(errors.prescriptionRequired(rxLines.map((l) => ({ id: l.medicationId, name: l.name }))));
    }
    if (rxLines.length > 0 && prescription) {
      const shapeErrors = validatePrescriptionShape(prescription);
      if (shapeErrors.length) return fail(...shapeErrors);
    }

    // --- Invariante 2: no vender ítems agotados (se reportan TODOS los faltantes) ---
    const stockErrors = lines
      .filter((l) => l.quantity > l.stock)
      .map((l) => errors.outOfStock({ id: l.medicationId, name: l.name }, l.quantity, l.stock));
    if (stockErrors.length) return fail(...stockErrors);

    // --- Reserva de inventario (filas ya bloqueadas; el WHERE es una segunda barrera) ---
    for (const l of lines) {
      const updated = await query(
        'order.reserveStock',
        `UPDATE medications SET stock = stock - $2, updated_at = now() WHERE id = $1 AND stock >= $2 RETURNING id`,
        [l.medicationId, l.quantity],
        tx,
      );
      if (updated.length === 0) return fail(errors.outOfStock({ id: l.medicationId, name: l.name }, l.quantity, 0));
    }

    const prescriptionStatus: PrescriptionStatus = rxLines.length > 0 ? 'SUBMITTED' : 'NOT_REQUIRED';
    const [order] = await query<{ id: string; createdAt: Date }>(
      'order.insert',
      `INSERT INTO orders (patient_id, status, prescription_status)
       VALUES ($1, 'PENDING_APPROVAL', $2) RETURNING id, created_at AS "createdAt"`,
      [patientId, prescriptionStatus],
      tx,
    );

    await query(
      'order.insertItems',
      `INSERT INTO order_items (order_id, medication_id, quantity, unit_price)
       SELECT $1, x.medication_id, x.quantity, x.unit_price
         FROM unnest($2::int[], $3::int[], $4::int[]) AS x(medication_id, quantity, unit_price)`,
      [order.id, lines.map((l) => l.medicationId), lines.map((l) => l.quantity), lines.map((l) => l.price)],
      tx,
    );

    if (prescription && rxLines.length > 0) {
      await query(
        'order.insertPrescription',
        `INSERT INTO prescriptions (order_id, doctor_name, doctor_license, issued_at, diagnosis, document_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, prescription.doctorName.trim(), prescription.doctorLicense.trim().toUpperCase(),
          prescription.issuedAt, prescription.diagnosis ?? null, prescription.documentUrl ?? null],
        tx,
      );
    }

    // El carrito se cierra y se abre uno nuevo vacío.
    await query('cart.checkout', `UPDATE carts SET checked_out = true, updated_at = now() WHERE id = $1`, [cartId], tx);
    await getOrCreateActiveCart(tx, patientId);

    await appendEvent(tx, order.id, {
      type: 'OrderPlaced',
      payload: {
        patientId,
        items: lines.map((l) => ({ medicationId: l.medicationId, quantity: l.quantity, unitPrice: l.price })),
        totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.price, 0),
        prescriptionStatus,
      },
    });

    return { errors: [], orderId: order.id, status: 'PENDING_APPROVAL', acceptedAt: order.createdAt };
  });
}

// =====================================================================
// Helpers de agregado
// =====================================================================
async function lockOrder(tx: PoolClient, orderId: string, patientId?: string) {
  const params: unknown[] = [orderId];
  let ownerSql = '';
  if (patientId) {
    params.push(patientId);
    ownerSql = 'AND patient_id = $2';
  }
  const [order] = await query<{ id: string; status: OrderStatus; prescriptionStatus: PrescriptionStatus }>(
    'order.lock',
    `SELECT id, status, prescription_status AS "prescriptionStatus"
       FROM orders WHERE id = $1 ${ownerSql} FOR UPDATE`,
    params,
    tx,
  );
  return order ?? null;
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function transition(tx: PoolClient, orderId: string, to: OrderStatus, extra: { cancelReason?: string } = {}) {
  await query(
    'order.transition',
    `UPDATE orders SET status = $2, cancel_reason = COALESCE($3, cancel_reason),
                       version = version + 1, updated_at = now()
      WHERE id = $1`,
    [orderId, to, extra.cancelReason ?? null],
    tx,
  );
}

async function releaseStock(tx: PoolClient, orderId: string) {
  return query<{ medicationId: number; quantity: number }>(
    'order.releaseStock',
    `UPDATE medications m SET stock = m.stock + oi.quantity, updated_at = now()
       FROM order_items oi
      WHERE oi.order_id = $1 AND oi.medication_id = m.id
      RETURNING m.id AS "medicationId", oi.quantity`,
    [orderId],
    tx,
  );
}

async function cancelWithinTx(tx: PoolClient, orderId: string, reason: string) {
  await transition(tx, orderId, 'CANCELLED', { cancelReason: reason });
  const releasedItems = await releaseStock(tx, orderId);
  await appendEvent(tx, orderId, { type: 'OrderCancelled', payload: { reason, releasedItems } });
}

// =====================================================================
// cancelOrder — iniciado por el paciente
// =====================================================================
export async function cancelOrder(patientId: string, input: { orderId: string; reason?: string | null }): Promise<OrderCommandResult> {
  if (!isUuid(input.orderId)) return { errors: [errors.notFound('Orden no encontrada.', ['input', 'orderId'])] };
  return withTransaction<OrderCommandResult>(async (tx) => {
    const order = await lockOrder(tx, input.orderId, patientId);
    if (!order) return fail(errors.notFound('Orden no encontrada.', ['input', 'orderId']));
    if (!canTransition(order.status, 'CANCELLED')) return fail(errors.invalidTransition(order.status, 'CANCELLED'));

    await cancelWithinTx(tx, order.id, input.reason?.trim() || 'Cancelada por el paciente.');
    return { errors: [], orderId: order.id, status: 'CANCELLED' };
  });
}

// =====================================================================
// dispatchOrder — operación de farmacia
// =====================================================================
export async function dispatchOrder(input: { orderId: string }): Promise<OrderCommandResult> {
  if (!isUuid(input.orderId)) return { errors: [errors.notFound('Orden no encontrada.', ['input', 'orderId'])] };
  return withTransaction<OrderCommandResult>(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return fail(errors.notFound('Orden no encontrada.', ['input', 'orderId']));
    if (!canTransition(order.status, 'DISPATCHED')) return fail(errors.invalidTransition(order.status, 'DISPATCHED'));

    await transition(tx, order.id, 'DISPATCHED');
    await appendEvent(tx, order.id, { type: 'OrderDispatched', payload: {} });
    return { errors: [], orderId: order.id, status: 'DISPATCHED' };
  });
}

// =====================================================================
// Comandos internos — los emite el process manager, no el cliente
// =====================================================================

/** Revisión de la fórmula por el químico farmacéutico (simulada). */
export async function reviewOrderPrescription(orderId: string) {
  await withTransaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || order.status !== 'PENDING_APPROVAL' || order.prescriptionStatus !== 'SUBMITTED') return {};

    const [p] = await query<{ doctorLicense: string; issuedAt: string }>(
      'prescription.get',
      `SELECT doctor_license AS "doctorLicense", issued_at AS "issuedAt" FROM prescriptions WHERE order_id = $1`,
      [orderId],
      tx,
    );
    const rejection = p ? reviewPrescription(p) : 'No se encontró la fórmula.';

    await query(
      'prescription.review',
      `UPDATE prescriptions SET reviewed_at = now(), rejection_reason = $2 WHERE order_id = $1`,
      [orderId, rejection],
      tx,
    );
    await query(
      'order.setPrescriptionStatus',
      `UPDATE orders SET prescription_status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
      [orderId, rejection ? 'REJECTED' : 'VALIDATED'],
      tx,
    );

    if (rejection) {
      await appendEvent(tx, orderId, { type: 'PrescriptionRejected', payload: { reason: rejection } });
      await cancelWithinTx(tx, orderId, `Fórmula rechazada: ${rejection}`);
    } else {
      await appendEvent(tx, orderId, { type: 'PrescriptionValidated', payload: {} });
      await approveWithinTx(tx, orderId, 'VALIDATED', 'Fórmula validada por químico farmacéutico.');
    }
    return {};
  });
}

/** Confirmación de pago para órdenes de venta libre (simulada). */
export async function approveOtcOrder(orderId: string) {
  await withTransaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || order.status !== 'PENDING_APPROVAL') return {};
    await approveWithinTx(tx, orderId, order.prescriptionStatus, 'Pago confirmado.');
    return {};
  });
}

async function approveWithinTx(tx: PoolClient, orderId: string, prescriptionStatus: PrescriptionStatus, note: string) {
  // Invariante: jamás aprobar una orden con fórmula no validada.
  if (!canApprove(prescriptionStatus)) {
    throw new Error(`Invariante violada: orden ${orderId} con fórmula ${prescriptionStatus} no puede aprobarse.`);
  }
  await transition(tx, orderId, 'APPROVED');
  await appendEvent(tx, orderId, { type: 'OrderApproved', payload: { note } });
}
