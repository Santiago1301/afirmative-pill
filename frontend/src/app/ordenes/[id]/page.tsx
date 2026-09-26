'use client';

import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading, StatusBadge, UserErrors } from '@/components/ui';
import {
  CANCEL_ORDER, DISPATCH_ORDER, ORDER_QUERY, ORDER_UPDATED,
  type OrderStatus, type UserError,
} from '@/graphql/operations';
import { dateTime, money, ORDER_STATUS_LABEL, PRESCRIPTION_STATUS_LABEL } from '@/lib/format';

const STEPS: OrderStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'DISPATCHED'];

/**
 * Escenario C — proyección de la orden con consistencia eventual y tiempo real.
 *
 * Tras placeOrder, la proyección puede NO existir todavía (el proyector es asíncrono):
 *   1. Query.order devuelve null → se muestra "procesando" y se hace polling cada 1 s.
 *   2. Subscription.orderUpdated empuja cada nueva versión de la proyección y se
 *      escribe en la caché, de modo que la vista se actualiza sola.
 */
export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [errors, setErrors] = useState<UserError[]>([]);
  // Comando aceptado pero aún no reflejado en la proyección.
  const [pendingCommand, setPendingCommand] = useState<OrderStatus | null>(null);

  const { data, loading, error, startPolling, stopPolling } = useQuery(ORDER_QUERY, { variables: { id } });
  const order = data?.order ?? null;

  // Mientras la proyección no exista, sondeamos cada 1 s (respaldo si el WebSocket tarda).
  const projectionMissing = !loading && !order;
  useEffect(() => {
    if (projectionMissing) startPolling(1000);
    else stopPolling();
    return () => stopPolling();
  }, [projectionMissing, startPolling, stopPolling]);

  useSubscription(ORDER_UPDATED, {
    variables: { orderId: id },
    onData: ({ client, data: result }) => {
      const updated = result.data?.orderUpdated;
      if (!updated) return;
      // Escribir la proyección en la caché → todos los componentes que la leen se re-renderizan.
      client.cache.writeQuery({ query: ORDER_QUERY, variables: { id }, data: { order: updated } });
      if (pendingCommand && updated.status === pendingCommand) setPendingCommand(null);
    },
  });

  const [cancelOrder, cancelState] = useMutation(CANCEL_ORDER);
  const [dispatchOrder, dispatchState] = useMutation(DISPATCH_ORDER);

  if (loading) return <Loading label="Consultando orden…" />;
  if (error) return <ErrorBox error={error} />;

  if (!order) {
    return (
      <section className="panel center">
        <h1>Orden recibida</h1>
        <Loading label="Estamos registrando tu orden. La vista se actualizará en unos segundos…" />
        <p className="muted small">
          El comando <code>placeOrder</code> ya fue confirmado (stock reservado). La proyección de lectura
          se materializa de forma asíncrona — consistencia eventual.
        </p>
        <code className="muted small">ID: {id}</code>
      </section>
    );
  }

  async function onCancel() {
    setErrors([]);
    const { data } = await cancelOrder({ variables: { orderId: id, reason: 'Cancelada por el paciente desde la app.' } });
    const errs = data?.cancelOrder.errors ?? [];
    setErrors(errs);
    if (errs.length === 0) setPendingCommand('CANCELLED');
  }

  async function onDispatch() {
    setErrors([]);
    const { data } = await dispatchOrder({ variables: { orderId: id } });
    const errs = data?.dispatchOrder.errors ?? [];
    setErrors(errs);
    if (errs.length === 0) setPendingCommand('DISPATCHED');
  }

  const effectivePending = pendingCommand && order.status !== pendingCommand ? pendingCommand : null;
  const canCancel = !order.isFinal && !effectivePending;
  const stepIndex = STEPS.indexOf(order.status);

  return (
    <div className="two-cols">
      <section>
        <Link href="/ordenes" className="muted small">← Mis órdenes</Link>
        <div className="detail-head">
          <h1>Orden <code>{order.id.slice(0, 8)}</code></h1>
          <StatusBadge status={order.status} />
        </div>

        {effectivePending && (
          <div className="alert info">
            <span className="spinner" /> Comando aceptado. Esperando que la proyección refleje{' '}
            <strong>{ORDER_STATUS_LABEL[effectivePending]}</strong>…
          </div>
        )}
        {order.status === 'PENDING_APPROVAL' && !effectivePending && (
          <div className="alert info">
            <span className="spinner" /> {order.statusNote}
          </div>
        )}
        {order.status === 'CANCELLED' && <div className="alert error">{order.statusNote}</div>}

        {order.status !== 'CANCELLED' && (
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i <= stepIndex ? 'done' : ''}>{ORDER_STATUS_LABEL[s]}</li>
            ))}
          </ol>
        )}

        <table className="table">
          <thead><tr><th>Medicamento</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.medication.id}>
                <td>{it.medication.name}<div className="muted small">{it.medication.presentation}</div></td>
                <td>{it.quantity}</td>
                <td>{money(it.unitPrice)}</td>
                <td>{money(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}><strong>Total</strong></td><td><strong>{money(order.totalAmount)}</strong></td></tr>
          </tfoot>
        </table>
      </section>

      <aside className="panel">
        <h2>Estado</h2>
        <p className="row"><span>Fórmula</span><span>{PRESCRIPTION_STATUS_LABEL[order.prescriptionStatus]}</span></p>
        <p className="row"><span>Creada</span><span>{dateTime(order.placedAt)}</span></p>
        <p className="row"><span>Última actualización</span><span>{dateTime(order.updatedAt)}</span></p>

        <h3>Historial</h3>
        <ul className="timeline">
          {order.statusHistory.map((h, i) => (
            <li key={i}>
              <StatusBadge status={h.status} />
              <div className="small muted">{dateTime(h.at)}</div>
              {h.note && <div className="small">{h.note}</div>}
            </li>
          ))}
        </ul>

        <UserErrors errors={errors} />
        <div className="stack">
          {canCancel && (
            <button className="btn danger block" onClick={onCancel} disabled={cancelState.loading}>
              {cancelState.loading ? 'Cancelando…' : 'Cancelar orden'}
            </button>
          )}
          {order.status === 'APPROVED' && !effectivePending && (
            <button className="btn ghost block" onClick={onDispatch} disabled={dispatchState.loading}>
              🏥 Despachar (simular farmacia)
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
