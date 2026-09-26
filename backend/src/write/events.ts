/**
 * Eventos de dominio emitidos por los comandos.
 * Se guardan en `domain_events` (patrón Transactional Outbox) dentro de la misma
 * transacción que el cambio de estado: si el comando se confirma, el evento también.
 */
import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';

export type DomainEvent =
  | { type: 'OrderPlaced'; payload: { patientId: string; items: { medicationId: number; quantity: number; unitPrice: number }[]; totalAmount: number; prescriptionStatus: 'NOT_REQUIRED' | 'SUBMITTED' } }
  | { type: 'PrescriptionValidated'; payload: Record<string, never> }
  | { type: 'PrescriptionRejected'; payload: { reason: string } }
  | { type: 'OrderApproved'; payload: { note: string } }
  | { type: 'OrderDispatched'; payload: Record<string, never> }
  | { type: 'OrderCancelled'; payload: { reason: string; releasedItems: { medicationId: number; quantity: number }[] } };

export type DomainEventType = DomainEvent['type'];

export async function appendEvent(tx: PoolClient, aggregateId: string, event: DomainEvent) {
  await query(
    'events.append',
    `INSERT INTO domain_events (aggregate_id, type, payload) VALUES ($1, $2, $3)`,
    [aggregateId, event.type, JSON.stringify(event.payload)],
    tx,
  );
}
