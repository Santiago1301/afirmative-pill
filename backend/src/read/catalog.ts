/**
 * READ MODEL — Catálogo.
 * Todas las consultas leen de la vista materializada `medication_catalog`
 * (desnormalizada e indexada). Nunca tocan las tablas del write model.
 */
import { query } from '../db/pool.js';

export interface MedicationView {
  id: number;
  sku: string;
  name: string;
  activeIngredient: string;
  categoryId: number;
  manufacturerId: number;
  dosage: string;
  presentation: string;
  price: number;
  stock: number;
  requiresPrescription: boolean;
  description: string;
}

export interface CategoryView { id: number; name: string; slug: string }
export interface ManufacturerView { id: number; name: string }

const MEDICATION_COLUMNS = `
  id, sku, name, active_ingredient AS "activeIngredient", category_id AS "categoryId",
  manufacturer_id AS "manufacturerId", dosage, presentation, price, stock,
  requires_prescription AS "requiresPrescription", description`;

export interface MedicationFilter {
  search?: string | null;
  activeIngredient?: string | null;
  categoryId?: string | null;
  manufacturerId?: string | null;
  requiresPrescription?: boolean | null;
  inStockOnly?: boolean | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}

const SORT_COLUMNS = { NAME: 'name', PRICE: 'price', STOCK: 'stock' } as const;

export async function searchMedications(
  filter: MedicationFilter = {},
  sort: { field: keyof typeof SORT_COLUMNS; direction: 'ASC' | 'DESC' },
  page: { limit: number; offset: number },
) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (filter.search?.trim()) add(`search_text LIKE '%' || lower(f_unaccent(?)) || '%'`, filter.search.trim());
  if (filter.activeIngredient?.trim())
    add(`lower(f_unaccent(active_ingredient)) LIKE '%' || lower(f_unaccent(?)) || '%'`, filter.activeIngredient.trim());
  if (filter.categoryId) add('category_id = ?', Number(filter.categoryId));
  if (filter.manufacturerId) add('manufacturer_id = ?', Number(filter.manufacturerId));
  if (filter.requiresPrescription != null) add('requires_prescription = ?', filter.requiresPrescription);
  if (filter.inStockOnly) where.push('stock > 0');
  if (filter.minPrice != null) add('price >= ?', filter.minPrice);
  if (filter.maxPrice != null) add('price <= ?', filter.maxPrice);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${SORT_COLUMNS[sort.field]} ${sort.direction === 'DESC' ? 'DESC' : 'ASC'}, id`;
  const limit = Math.min(page.limit, 100);

  // Una sola consulta devuelve la página y el total (window function).
  const rows = await query<MedicationView & { totalCount: number }>(
    'catalog.search',
    `SELECT ${MEDICATION_COLUMNS}, count(*) OVER () AS "totalCount"
       FROM medication_catalog ${whereSql} ${orderSql}
      LIMIT ${limit} OFFSET $${params.length + 1}`,
    [...params, Math.max(page.offset, 0)],
  );

  const totalCount = rows[0]?.totalCount ?? 0;
  return {
    items: rows as MedicationView[],
    totalCount,
    hasMore: page.offset + rows.length < totalCount,
  };
}

// ---------- Funciones batch usadas por los DataLoaders ----------
// Reciben N claves y hacen UNA sola consulta con = ANY($1).

export function medicationsByIds(ids: readonly number[]) {
  return query<MedicationView>(
    'catalog.medicationsByIds',
    `SELECT ${MEDICATION_COLUMNS} FROM medication_catalog WHERE id = ANY($1::int[])`,
    [ids],
  );
}

export function medicationsByCategoryIds(ids: readonly number[]) {
  return query<MedicationView>(
    'catalog.medicationsByCategoryIds',
    `SELECT ${MEDICATION_COLUMNS} FROM medication_catalog WHERE category_id = ANY($1::int[]) ORDER BY name`,
    [ids],
  );
}

export function medicationsByManufacturerIds(ids: readonly number[]) {
  return query<MedicationView>(
    'catalog.medicationsByManufacturerIds',
    `SELECT ${MEDICATION_COLUMNS} FROM medication_catalog WHERE manufacturer_id = ANY($1::int[]) ORDER BY name`,
    [ids],
  );
}

export function categoriesByIds(ids: readonly number[]) {
  return query<CategoryView>('catalog.categoriesByIds', `SELECT id, name, slug FROM categories WHERE id = ANY($1::int[])`, [ids]);
}

export function manufacturersByIds(ids: readonly number[]) {
  return query<ManufacturerView>('catalog.manufacturersByIds', `SELECT id, name FROM manufacturers WHERE id = ANY($1::int[])`, [ids]);
}

export function listCategories() {
  return query<CategoryView>('catalog.categories', `SELECT id, name, slug FROM categories ORDER BY name`);
}

export function listManufacturers() {
  return query<ManufacturerView>('catalog.manufacturers', `SELECT id, name FROM manufacturers ORDER BY name`);
}
