/**
 * PROCESS MANAGER (saga) — reacciona a eventos y emite comandos internos.
 *
 *   OrderPlaced (con fórmula) ──(revisión QF)──► PrescriptionValidated + OrderApproved
 *                                           └──► PrescriptionRejected  + OrderCancelled (libera stock)
 *   OrderPlaced (venta libre) ──(pago)────────► OrderApproved
 *
 * APPROVAL_DELAY_MS simula el tiempo real de revisión/pago: durante ese lapso la
 * orden permanece en PENDING_APPROVAL y el cliente lo ve en la proyección.
 */
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { approveOtcOrder, reviewOrderPrescription } from '../write/commands/orders.js';

async function tick() {
  // Solo OrderPlaced dispara pasos del flujo; el resto se marca como atendido en bloque.
  await query('poll:processManager.skip', `UPDATE domain_events SET handled_at = now() WHERE handled_at IS NULL AND type <> 'OrderPlaced'`);

  const events = await query<{ id: number; aggregateId: string; type: string; payload: any }>(
    'poll:processManager.pending',
    `SELECT id, aggregate_id AS "aggregateId", type, payload FROM domain_events
      WHERE handled_at IS NULL AND type = 'OrderPlaced'
        AND occurred_at <= now() - make_interval(secs => $1::float / 1000)
      ORDER BY id LIMIT 20`,
    [config.approvalDelayMs],
  );

  for (const e of events) {
    if (e.payload.prescriptionStatus === 'SUBMITTED') {
      console.log(`\x1b[33m[ProcessManager] revisando fórmula de la orden ${e.aggregateId.slice(0, 8)}\x1b[0m`);
      await reviewOrderPrescription(e.aggregateId);
    } else {
      console.log(`\x1b[33m[ProcessManager] confirmando pago de la orden ${e.aggregateId.slice(0, 8)}\x1b[0m`);
      await approveOtcOrder(e.aggregateId);
    }
    // Los comandos internos son idempotentes (verifican el estado), así que reintentar es seguro.
    await query('processManager.markHandled', `UPDATE domain_events SET handled_at = now() WHERE id = $1`, [e.id]);
  }
}

export function startProcessManager(intervalMs = 500) {
  let stopped = false;
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[ProcessManager] error', err);
    }
    if (!stopped) setTimeout(loop, intervalMs);
  };
  void loop();
  return () => { stopped = true; };
}
