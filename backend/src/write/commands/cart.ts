/**
 * COMMAND HANDLERS — Carrito.
 * Validan contra el write model (stock real) y no reservan inventario:
 * la reserva atómica ocurre solo en placeOrder.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { errors, type UserError } from '../domain.js';

export interface CartCommandResult { errors: UserError[] }

export async function getOrCreateActiveCart(tx: PoolClient, patientId: string): Promise<string> {
  await query(
    'cart.ensure',
    `INSERT INTO carts (patient_id) VALUES ($1) ON CONFLICT (patient_id) WHERE NOT checked_out DO NOTHING`,
    [patientId],
    tx,
  );
  // FOR UPDATE serializa comandos concurrentes sobre el mismo carrito.
  const [cart] = await query<{ id: string }>(
    'cart.lock',
    `SELECT id FROM carts WHERE patient_id = $1 AND NOT checked_out FOR UPDATE`,
    [patientId],
    tx,
  );
  return cart.id;
}

async function loadMedication(tx: PoolClient, medicationId: string) {
  const id = Number(medicationId);
  if (!Number.isInteger(id)) return null;
  const [med] = await query<{ id: number; name: string; stock: number }>(
    'medications.get',
    `SELECT id, name, stock FROM medications WHERE id = $1`,
    [id],
    tx,
  );
  return med ?? null;
}

export function addToCart(patientId: string, input: { medicationId: string; quantity: number }) {
  return setQuantity(patientId, input.medicationId, (current) => current + input.quantity);
}

export function updateCartItem(patientId: string, input: { medicationId: string; quantity: number }) {
  return setQuantity(patientId, input.medicationId, () => input.quantity);
}

async function setQuantity(patientId: string, medicationId: string, next: (current: number) => number): Promise<CartCommandResult> {
  return withTransaction(async (tx) => {
    const med = await loadMedication(tx, medicationId);
    if (!med) return { errors: [errors.notFound(`No existe el medicamento ${medicationId}.`, ['input', 'medicationId'])] };

    const cartId = await getOrCreateActiveCart(tx, patientId);
    const [existing] = await query<{ quantity: number }>(
      'cart.item',
      `SELECT quantity FROM cart_items WHERE cart_id = $1 AND medication_id = $2`,
      [cartId, med.id],
      tx,
    );
    const quantity = next(existing?.quantity ?? 0);

    // Invariante: no se puede pedir más de lo que hay en bodega.
    if (quantity > med.stock) {
      return { errors: [errors.outOfStock(med, quantity, med.stock, ['input', 'quantity'])] };
    }

    await query(
      'cart.upsertItem',
      `INSERT INTO cart_items (cart_id, medication_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, medication_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [cartId, med.id, quantity],
      tx,
    );
    await query('cart.touch', `UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId], tx);
    return { errors: [] };
  });
}

export async function removeFromCart(patientId: string, input: { medicationId: string }): Promise<CartCommandResult> {
  return withTransaction(async (tx) => {
    const cartId = await getOrCreateActiveCart(tx, patientId);
    const removed = await query(
      'cart.removeItem',
      `DELETE FROM cart_items WHERE cart_id = $1 AND medication_id = $2 RETURNING medication_id`,
      [cartId, Number(input.medicationId) || 0],
      tx,
    );
    if (removed.length === 0) {
      return { errors: [errors.notFound('Ese medicamento no está en el carrito.', ['input', 'medicationId'])] };
    }
    return { errors: [] };
  });
}
