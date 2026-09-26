/**
 * WRITE MODEL — Reglas de dominio puras (sin I/O).
 * Aquí viven las invariantes farmacéuticas y la máquina de estados de la orden.
 */

export type OrderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISPATCHED' | 'CANCELLED';
export type PrescriptionStatus = 'NOT_REQUIRED' | 'SUBMITTED' | 'VALIDATED' | 'REJECTED';

// ---------- Errores de dominio (se devuelven en los payloads) ----------

export type UserError =
  | { __typename: 'ValidationError'; code: 'VALIDATION_FAILED'; message: string; field?: string[] }
  | { __typename: 'NotFoundError'; code: 'NOT_FOUND'; message: string; field?: string[] }
  | { __typename: 'EmptyCartError'; code: 'EMPTY_CART'; message: string; field?: string[] }
  | { __typename: 'OutOfStockError'; code: 'OUT_OF_STOCK'; message: string; field?: string[]; medicationId: number; requested: number; available: number }
  | { __typename: 'PrescriptionRequiredError'; code: 'PRESCRIPTION_REQUIRED'; message: string; field?: string[]; medicationIds: number[] }
  | { __typename: 'InvalidStateTransitionError'; code: 'INVALID_STATE_TRANSITION'; message: string; field?: string[]; currentStatus: OrderStatus; attemptedStatus: OrderStatus };

export const errors = {
  validation: (message: string, field?: string[]): UserError => ({ __typename: 'ValidationError', code: 'VALIDATION_FAILED', message, field }),
  notFound: (message: string, field?: string[]): UserError => ({ __typename: 'NotFoundError', code: 'NOT_FOUND', message, field }),
  emptyCart: (): UserError => ({ __typename: 'EmptyCartError', code: 'EMPTY_CART', message: 'El carrito está vacío.' }),
  outOfStock: (m: { id: number; name: string }, requested: number, available: number, field?: string[]): UserError => ({
    __typename: 'OutOfStockError', code: 'OUT_OF_STOCK', field, medicationId: m.id, requested, available,
    message: available === 0
      ? `${m.name} está agotado.`
      : `Solo hay ${available} unidad(es) de ${m.name}; solicitaste ${requested}.`,
  }),
  prescriptionRequired: (meds: { id: number; name: string }[]): UserError => ({
    __typename: 'PrescriptionRequiredError', code: 'PRESCRIPTION_REQUIRED', field: ['prescription'],
    medicationIds: meds.map((m) => m.id),
    message: `Se requiere fórmula médica para: ${meds.map((m) => m.name).join(', ')}.`,
  }),
  invalidTransition: (from: OrderStatus, to: OrderStatus): UserError => ({
    __typename: 'InvalidStateTransitionError', code: 'INVALID_STATE_TRANSITION', currentStatus: from, attemptedStatus: to,
    message: `No se puede pasar una orden de ${from} a ${to}.`,
  }),
};

// ---------- Máquina de estados de la orden ----------

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Invariante: una orden con fórmula solo puede aprobarse si la fórmula fue VALIDADA.
 */
export function canApprove(prescriptionStatus: PrescriptionStatus): boolean {
  return prescriptionStatus === 'NOT_REQUIRED' || prescriptionStatus === 'VALIDATED';
}

// ---------- Fórmula médica ----------

export interface PrescriptionInput {
  doctorName: string;
  doctorLicense: string;
  issuedAt: string; // YYYY-MM-DD
  diagnosis?: string | null;
  documentUrl?: string | null;
}

export const PRESCRIPTION_MAX_AGE_DAYS = 30;
const LICENSE_PATTERN = /^RM-?\d{4,8}$/i;

/** Validación sintáctica inmediata (dentro del comando). */
export function validatePrescriptionShape(p: PrescriptionInput): UserError[] {
  const out: UserError[] = [];
  if (p.doctorName.trim().length < 3) out.push(errors.validation('Nombre del médico inválido.', ['prescription', 'doctorName']));
  if (!p.doctorLicense.trim()) out.push(errors.validation('El registro médico es obligatorio.', ['prescription', 'doctorLicense']));
  if (daysSince(p.issuedAt) < 0) out.push(errors.validation('La fecha de la fórmula no puede estar en el futuro.', ['prescription', 'issuedAt']));
  return out;
}

/**
 * Revisión "del químico farmacéutico" (asíncrona, la ejecuta el process manager).
 * Devuelve null si es válida o el motivo de rechazo.
 */
export function reviewPrescription(p: { doctorLicense: string; issuedAt: string }): string | null {
  if (!LICENSE_PATTERN.test(p.doctorLicense.trim())) {
    return `Registro médico "${p.doctorLicense}" no válido (formato esperado RM-12345).`;
  }
  const age = daysSince(p.issuedAt);
  if (age > PRESCRIPTION_MAX_AGE_DAYS) return `La fórmula tiene ${age} días; el máximo permitido es ${PRESCRIPTION_MAX_AGE_DAYS}.`;
  return null;
}

function daysSince(isoDate: string): number {
  const issued = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - issued) / 86_400_000);
}
