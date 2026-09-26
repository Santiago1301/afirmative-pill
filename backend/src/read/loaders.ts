/**
 * DataLoaders — mitigación del problema N+1.
 *
 * Se crea un juego NUEVO de loaders por cada request (o por cada operación de
 * subscription), lo que da:
 *   • Batching: todas las claves pedidas en el mismo tick se resuelven con UNA consulta (= ANY($1)).
 *   • Caché por request: la misma clave pedida dos veces en la misma operación no vuelve a la BD.
 *   • Aislamiento: nada se comparte entre usuarios ni entre requests.
 */
import DataLoader from 'dataloader';
import {
  categoriesByIds, manufacturersByIds, medicationsByCategoryIds, medicationsByIds, medicationsByManufacturerIds,
  type CategoryView, type ManufacturerView, type MedicationView,
} from './catalog.js';
import { patientsByIds, type PatientView } from './orders.js';

function logBatch(name: string, keys: readonly unknown[]) {
  console.log(`\x1b[36m[DataLoader] ${name}: ${keys.length} clave(s) agrupadas en 1 consulta → [${keys.join(', ')}]\x1b[0m`);
}

/** Crea un loader "uno a uno": cada clave devuelve una entidad (o null). */
function byId<K extends number | string, V extends { id: K }>(
  name: string,
  fetch: (keys: readonly K[]) => Promise<V[]>,
) {
  return new DataLoader<K, V | null>(async (keys) => {
    logBatch(name, keys);
    const rows = await fetch(keys);
    const map = new Map(rows.map((r) => [String(r.id), r]));
    // DataLoader exige devolver los resultados en el MISMO orden que las claves.
    return keys.map((k) => map.get(String(k)) ?? null);
  });
}

/** Crea un loader "uno a muchos": cada clave devuelve una lista. */
function groupBy<V>(
  name: string,
  fetch: (keys: readonly number[]) => Promise<V[]>,
  keyOf: (row: V) => number,
) {
  return new DataLoader<number, V[]>(async (keys) => {
    logBatch(name, keys);
    const rows = await fetch(keys);
    const groups = new Map<number, V[]>(keys.map((k) => [k, []]));
    for (const row of rows) groups.get(keyOf(row))?.push(row);
    return keys.map((k) => groups.get(k) ?? []);
  });
}

export function createLoaders() {
  return {
    medicationById: byId<number, MedicationView>('medicationById', medicationsByIds),
    categoryById: byId<number, CategoryView>('categoryById', categoriesByIds),
    manufacturerById: byId<number, ManufacturerView>('manufacturerById', manufacturersByIds),
    patientById: byId<string, PatientView>('patientById', patientsByIds),
    medicationsByCategory: groupBy('medicationsByCategory', medicationsByCategoryIds, (m) => m.categoryId),
    medicationsByManufacturer: groupBy('medicationsByManufacturer', medicationsByManufacturerIds, (m) => m.manufacturerId),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
