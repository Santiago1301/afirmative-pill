'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useEffect } from 'react';
import { ErrorBox, Loading, StatusBadge } from '@/components/ui';
import { MY_ORDERS_QUERY, MY_ORDERS_UPDATED, type OrderSummary } from '@/graphql/operations';
import { dateTime, money } from '@/lib/format';

/** Lista de proyecciones de órdenes, actualizada en tiempo real con subscribeToMore. */
export default function MyOrdersPage() {
  const { data, loading, error, subscribeToMore } = useQuery(MY_ORDERS_QUERY, { fetchPolicy: 'cache-and-network' });

  useEffect(
    () =>
      subscribeToMore({
        document: MY_ORDERS_UPDATED,
        // Fusiona la proyección recibida en la lista: reemplaza si existe, inserta si es nueva.
        updateQuery: (prev, { subscriptionData }) => {
          const updated = subscriptionData.data?.myOrdersUpdated as OrderSummary | undefined;
          const list = (prev?.myOrders ?? []) as OrderSummary[];
          if (!updated) return prev as { myOrders: OrderSummary[] };
          const exists = list.some((o) => o.id === updated.id);
          return { myOrders: exists ? list.map((o) => (o.id === updated.id ? updated : o)) : [updated, ...list] };
        },
      }),
    [subscribeToMore],
  );

  if (loading && !data) return <Loading label="Cargando órdenes…" />;
  if (error) return <ErrorBox error={error} />;
  const orders = data?.myOrders ?? [];

  return (
    <section>
      <h1>Mis órdenes</h1>
      {orders.length === 0 && <p className="muted">Aún no tienes órdenes. <Link href="/">Ir al catálogo</Link></p>}
      <div className="list">
        {orders.map((o) => (
          <Link key={o.id} href={`/ordenes/${o.id}`} className="list-item">
            <div>
              <strong>Orden {o.id.slice(0, 8)}</strong>
              <div className="muted small">{dateTime(o.placedAt)} · {o.itemCount} unidad(es)</div>
            </div>
            <div className="right">
              <StatusBadge status={o.status} />
              <div className="price">{money(o.totalAmount)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
