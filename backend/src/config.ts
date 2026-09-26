import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa backend/.env (ver .env.example).`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  /** Retraso mínimo antes de proyectar un evento: hace visible la consistencia eventual. */
  projectionDelayMs: Number(process.env.PROJECTION_DELAY_MS ?? 1500),
  /** Tiempo simulado de revisión de fórmula / confirmación de pago. */
  approvalDelayMs: Number(process.env.APPROVAL_DELAY_MS ?? 5000),
  /** Paciente fijo de la demo (sin autenticación). Lo crea db/setup.ts. */
  demoPatientId: '00000000-0000-4000-8000-000000000001',
  lowStockThreshold: 10,
};
