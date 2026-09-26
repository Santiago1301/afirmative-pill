import type { OrderStatus, PrescriptionStatus, StockLevel } from '@/graphql/operations';

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const money = (value: number) => cop.format(value);

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Aprobada',
  DISPATCHED: 'Despachada',
  CANCELLED: 'Cancelada',
};

export const PRESCRIPTION_STATUS_LABEL: Record<PrescriptionStatus, string> = {
  NOT_REQUIRED: 'No requiere fórmula',
  SUBMITTED: 'Fórmula en revisión',
  VALIDATED: 'Fórmula validada',
  REJECTED: 'Fórmula rechazada',
};

export const STOCK_LABEL: Record<StockLevel, string> = {
  IN_STOCK: 'Disponible',
  LOW_STOCK: 'Pocas unidades',
  OUT_OF_STOCK: 'Agotado',
};
