/**
 * PROYECTOR — construye el READ MODEL a partir de los eventos de dominio.
 *
 *   domain_events (outbox) ──► proyector ──► order_summaries / medication_catalog ──► pubsub ──► Subscriptions
 *
 * Corre en segundo plano, desacoplado de los comandos. Por eso existe una ventana
 * de CONSISTENCIA EVENTUAL entre "comando confirmado" y "proyección visible".
 * PROJECTION_DELAY_MS amplía esa ventana a propósito para que se aprecie en la demo.
 */
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { ORDER_SUMMARY_COLUMNS, type OrderSummaryView } from '../read/orders.js';
import { ORDER_UPDATED, pubsub } from './pubsub.js';

interface StoredEvent { id: number; aggregateId: string; type: string; payload: any; occurredAt: Date }

const STOCK_EVENTS = new Set(['OrderPlaced', 'OrderCancelled']);

/** Pliega (fold) la secuencia de eventos de una orden en su documento de lectura. */
function foldOrder(events: StoredEvent[]) {
  const placed = events.find((e) => e.type === 'OrderPlaced');
  if (!placed) return null;

  const doc = {
    patientId: placed.payload.patientId as string,
    status: 'PENDING_APPROVAL',
    prescriptionStatus: placed.payload.prescriptionStatus as string,
    statusNote: null as string | null,
    totalAmount: placed.payload.totalAmount as number,
    items: (placed.payload.items as { medicationId: number; quantity: number; unitPrice: number }[]).map((i) => ({
      ...i, subtotal: i.quantity * i.unitPrice,
    })),
    statusHistory: [] as { status: string; at: Date; note: string | null }[],
    placedAt: placed.occurredAt,
    updatedAt: placed.occurredAt,
    lastEventId: 0,
  };

  const push = (status: string, at: Date, note: string | null) => {
    doc.status = status;
    doc.statusNote = note;
    doc.statusHistory.push({ status, at, note });
  };

  for (const e of events) {
    switch (e.type) {
      case 'OrderPlaced':
        push('PENDING_APPROVAL', e.occurredAt,
          doc.prescriptionStatus === 'SUBMITTED'
            ? 'Stock reservado. Fórmula médica en revisión por el químico farmacéutico.'
            : 'Stock reservado. Confirmando pago.');
        break;
      case 'PrescriptionValidated':
        doc.prescriptionStatus = 'VALIDATED';
        break;
      case 'PrescriptionRejected':
        doc.prescriptionStatus = 'REJECTED';
        break;
      case 'OrderApproved':
        push('APPROVED', e.occurredAt, e.payload.note);
        break;
      case 'OrderDispatched':
        push('DISPATCHED', e.occurredAt, 'La orden salió de la farmacia.');
        break;
      case 'OrderCancelled':
        push('CANCELLED', e.occurredAt, e.payload.reason);
        break;
    }
    doc.updatedAt = e.occurredAt;
    doc.lastEventId = e.id;
  }
  return doc;
}

async function projectOrder(tx: PoolClient, orderId: string, upToEventId: number) {
  const events = await query<StoredEvent>(
    'projector.orderEvents',
    `SELECT id, aggregate_id AS "aggregateId", type, payload, occurred_at AS "occurredAt"
       FROM domain_events WHERE aggregate_id = $1 AND id <= $2 ORDER BY id`,
    [orderId, upToEventId],
    tx,
  );
  const doc = foldOrder(events);
  if (!doc) return;

  await query(
    'projector.upsertOrderSummary',
    `INSERT INTO order_summaries
       (order_id, patient_id, status, prescription_status, status_note, total_amount, item_count,
        items, status_history, placed_at, updated_at, last_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (order_id) DO UPDATE SET
       status = EXCLUDED.status, prescription_status = EXCLUDED.prescription_status,
       status_note = EXCLUDED.status_note, total_amount = EXCLUDED.total_amount,
       item_count = EXCLUDED.item_count, items = EXCLUDED.items, status_history = EXCLUDED.status_history,
       updated_at = EXCLUDED.updated_at, last_event_id = EXCLUDED.last_event_id
     WHERE order_summaries.last_event_id < EXCLUDED.last_event_id`, // idempotente
    [
      orderId, doc.patientId, doc.status, doc.prescriptionStatus, doc.statusNote, doc.totalAmount,
      doc.items.reduce((n, i) => n + i.quantity, 0), JSON.stringify(doc.items),
      JSON.stringify(doc.statusHistory), doc.placedAt, doc.updatedAt, doc.lastEventId,
    ],
    tx,
  );
}

async function tick() {
  const batch = await withTransaction(async (tx) => {
    const events = await query<{ id: number; aggregateId: string; type: string }>(
      'poll:projector.pending',
      `SELECT id, aggregate_id AS "aggregateId", type FROM domain_events
        WHERE projected_at IS NULL AND occurred_at <= now() - make_interval(secs => $1::float / 1000)
        ORDER BY id LIMIT 100
          FOR UPDATE SKIP LOCKED`,
      [config.projectionDelayMs],
      tx,
    );
    if (events.length === 0) return { orderIds: [] as string[], stockChanged: false };

    const maxId = events[events.length - 1].id;
    const orderIds = [...new Set(events.map((e) => e.aggregateId))];
    console.log(`\x1b[35m[Projector] proyectando ${events.length} evento(s): ${events.map((e) => e.type).join(', ')}\x1b[0m`);

    for (const orderId of orderIds) await projectOrder(tx, orderId, maxId);
    await query('projector.markProjected', `UPDATE domain_events SET projected_at = now() WHERE id = ANY($1::bigint[])`, [events.map((e) => e.id)], tx);

    return { orderIds, stockChanged: events.some((e) => STOCK_EVENTS.has(e.type)) };
  });

  if (batch.stockChanged) {
    // El stock del catálogo es una proyección más: se sincroniza aquí (consistencia eventual).
    await query('projector.refreshCatalog', 'REFRESH MATERIALIZED VIEW CONCURRENTLY medication_catalog');
  }

  if (batch.orderIds.length) {
    const summaries = await query<OrderSummaryView>(
      'projector.publish',
      `SELECT ${ORDER_SUMMARY_COLUMNS} FROM order_summaries WHERE order_id = ANY($1::uuid[])`,
      [batch.orderIds],
    );
    for (const s of summaries) {
      console.log(`\x1b[35m[Projector] orden ${s.id.slice(0, 8)} → ${s.status} (publicado a subscriptions)\x1b[0m`);
      await pubsub.publish(ORDER_UPDATED, s);
    }
  }
}

export function startProjector(intervalMs = 400) {
  let stopped = false;
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[Projector] error', err);
    }
    if (!stopped) setTimeout(loop, intervalMs);
  };
  void loop();
  return () => { stopped = true; };
}

