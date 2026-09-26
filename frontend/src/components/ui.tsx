import type { OrderStatus, UserError } from '@/graphql/operations';
import { ORDER_STATUS_LABEL } from '@/lib/format';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

export function RxBadge() {
  return <span className="badge rx" title="Requiere fórmula médica">Rx · Fórmula</span>;
}

/** Errores de dominio devueltos en el payload de las mutaciones. */
export function UserErrors({ errors }: { errors: UserError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="alert error" role="alert">
      {errors.map((e, i) => (
        <p key={i}>
          <strong>{e.code}</strong> — {e.message}
        </p>
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: { message: string } }) {
  return <div className="alert error">Error de red/GraphQL: {error.message}</div>;
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return <p className="muted"><span className="spinner" /> {label}</p>;
}
