'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AddToCartButton } from '@/components/AddToCartButton';
import { ErrorBox, Loading, RxBadge } from '@/components/ui';
import { MEDICATION_DETAIL_QUERY } from '@/graphql/operations';
import { money, STOCK_LABEL } from '@/lib/format';

/** Escenario A — ficha técnica: aquí sí se piden laboratorio, categoría e indicaciones. */
export default function MedicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useQuery(MEDICATION_DETAIL_QUERY, { variables: { id } });

  if (loading) return <Loading label="Cargando ficha técnica…" />;
  if (error) return <ErrorBox error={error} />;
  const m = data?.medication;
  if (!m) return <p>Medicamento no encontrado. <Link href="/">Volver al catálogo</Link></p>;

  return (
    <article className="detail">
      <Link href="/" className="muted small">← Catálogo</Link>
      <div className="detail-head">
        <div>
          <h1>{m.name}</h1>
          <p className="muted">{m.activeIngredient} · {m.dosage} · {m.presentation}</p>
        </div>
        {m.requiresPrescription && <RxBadge />}
      </div>

      {m.requiresPrescription && (
        <div className="alert warn">
          Este medicamento <strong>requiere fórmula médica</strong>. Al confirmar la orden deberás
          adjuntar los datos del médico prescriptor; la orden quedará en revisión hasta validarla.
        </div>
      )}

      <dl className="specs">
        <dt>SKU</dt><dd>{m.sku}</dd>
        <dt>Principio activo</dt><dd>{m.activeIngredient}</dd>
        <dt>Concentración</dt><dd>{m.dosage}</dd>
        <dt>Presentación</dt><dd>{m.presentation}</dd>
        <dt>Categoría terapéutica</dt><dd>{m.category.name}</dd>
        <dt>Laboratorio</dt><dd>{m.manufacturer.name}</dd>
        <dt>Indicaciones</dt><dd>{m.description}</dd>
        <dt>Disponibilidad</dt><dd>{STOCK_LABEL[m.stockLevel]} ({m.stock} unidades)</dd>
      </dl>

      <div className="detail-buy">
        <span className="price big">{money(m.price)}</span>
        <AddToCartButton medicationId={m.id} disabled={m.stock === 0} />
      </div>
    </article>
  );
}
