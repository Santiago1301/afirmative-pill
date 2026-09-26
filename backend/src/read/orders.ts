/**
 * READ MODEL — Órdenes, carrito y paciente.
 * Las órdenes se leen EXCLUSIVAMENTE de la proyección `order_summaries`.
 */
import { query } from '../db/pool.js';

export interface OrderLineView { medicationId: number; quantity: number; unitPrice: number; subtotal: number }
export interface StatusChangeView { status: string; at: string; note: string | null }

export interface OrderSummaryView {
  id: string;
  patientId: string;
  status: string;
  prescriptionStatus: string;
  statusNote: string | null;
  totalAmount: number;
  itemCount: number;
  items: OrderLineView[];
  statusHistory: StatusChangeView[];
  placedAt: Date;
  updatedAt: Date;
}

export const ORDER_SUMMARY_COLUMNS = `
  order_id AS id, patient_id AS "patientId", status, prescription_status AS "prescriptionStatus",
  status_note AS "statusNote", total_amount AS "totalAmount", item_count AS "itemCount", items,
  status_history AS "statusHistory", placed_at AS "placedAt", updated_at AS "updatedAt"`;

export async function getOrderSummary(orderId: string, patientId: string) {
  const [row] = await query<OrderSummaryView>(
    'orders.summary',
    `SELECT ${ORDER_SUMMARY_COLUMNS} FROM order_summaries WHERE order_id = $1 AND patient_id = $2`,
    [orderId, patientId],
  );
  return row ?? null;
}

export function listOrderSummaries(patientId: string, status: string | null, page: { limit: number; offset: number }) {
  const params: unknown[] = [patientId];
  let statusSql = '';
  if (status) {
    params.push(status);
    statusSql = `AND status = $2`;
  }
  params.push(Math.min(page.limit, 100), Math.max(page.offset, 0));
  return query<OrderSummaryView>(
    'orders.list',
    `SELECT ${ORDER_SUMMARY_COLUMNS} FROM order_summaries
      WHERE patient_id = $1 ${statusSql}
      ORDER BY placed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

// ---------- Carrito ----------
// El carrito es estado de sesión del propio paciente: se lee directo de sus tablas
// con consistencia fuerte (no tiene sentido una proyección asíncrona aquí).

export interface CartView { id: string; items: { medicationId: number; quantity: number }[] }

export async function getActiveCart(patientId: string): Promise<CartView | null> {
  const rows = await query<{ id: string; medicationId: number | null; quantity: number | null }>(
    'cart.active',
    `SELECT c.id, ci.medication_id AS "medicationId", ci.quantity
       FROM carts c LEFT JOIN cart_items ci ON ci.cart_id = c.id
      WHERE c.patient_id = $1 AND NOT c.checked_out
      ORDER BY ci.added_at`,
    [patientId],
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    items: rows.filter((r) => r.medicationId != null).map((r) => ({ medicationId: r.medicationId!, quantity: r.quantity! })),
  };
}

// ---------- Paciente ----------

export interface PatientView { id: string; fullName: string; documentId: string; email: string }

export function patientsByIds(ids: readonly string[]) {
  return query<PatientView>(
    'patients.byIds',
    `SELECT id, full_name AS "fullName", document_id AS "documentId", email FROM patients WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}
