import { config } from '../config.js';
import { createLoaders, type Loaders } from '../read/loaders.js';

export interface Context {
  /** Paciente "autenticado". En la demo es fijo; en producción saldría del JWT. */
  patientId: string;
  loaders: Loaders;
}

/** Se invoca por cada request HTTP y por cada operación de subscription (WebSocket). */
export function buildContext(): Context {
  return { patientId: config.demoPatientId, loaders: createLoaders() };
}
