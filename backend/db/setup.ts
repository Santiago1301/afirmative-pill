/**
 * Crea el esquema (write model + read model) y carga el dataset de 50 medicamentos.
 * Es idempotente: puede ejecutarse varias veces sin duplicar datos.
 *
 *   npm run db:setup
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { pool, withTransaction } from '../src/db/pool.js';
import { config } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));

type Row = {
  id: string; sku: string; name: string; active_ingredient: string; category: string;
  dosage: string; presentation: string; price: string; stock: string;
  requires_prescription: string; manufacturer: string; description: string;
};

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function migrate() {
  const dir = join(here, 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    console.log(`→ migración ${file}`);
    await pool.query(readFileSync(join(dir, file), 'utf8'));
  }
}

async function seed() {
  const rows: Row[] = parse(readFileSync(join(here, 'seed', 'medications.csv')), {
    columns: true, skip_empty_lines: true, trim: true, bom: true,
  });
  console.log(`→ seed: ${rows.length} medicamentos desde CSV`);

  await withTransaction(async (tx) => {
    for (const name of new Set(rows.map((r) => r.category))) {
      await tx.query(
        `INSERT INTO categories (name, slug) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [name, slugify(name)],
      );
    }
    for (const name of new Set(rows.map((r) => r.manufacturer))) {
      await tx.query(`INSERT INTO manufacturers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
    }
    for (const r of rows) {
      await tx.query(
        `INSERT INTO medications
           (id, sku, name, active_ingredient, category_id, manufacturer_id, dosage, presentation,
            price, stock, requires_prescription, description)
         VALUES ($1, $2, $3, $4,
                 (SELECT id FROM categories WHERE name = $5),
                 (SELECT id FROM manufacturers WHERE name = $6),
                 $7, $8, $9, $10, $11, $12)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name, active_ingredient = EXCLUDED.active_ingredient,
           category_id = EXCLUDED.category_id, manufacturer_id = EXCLUDED.manufacturer_id,
           dosage = EXCLUDED.dosage, presentation = EXCLUDED.presentation, price = EXCLUDED.price,
           requires_prescription = EXCLUDED.requires_prescription, description = EXCLUDED.description,
           updated_at = now()`,
        [
          Number(r.id), r.sku, r.name, r.active_ingredient, r.category, r.manufacturer,
          r.dosage, r.presentation, Number(r.price), Number(r.stock),
          r.requires_prescription.toUpperCase() === 'TRUE', r.description,
        ],
      );
    }
    await tx.query(`SELECT setval('medications_id_seq', (SELECT max(id) FROM medications))`);

    await tx.query(
      `INSERT INTO patients (id, full_name, document_id, email)
       VALUES ($1, 'Paciente Demo', 'CC 1000000001', 'paciente.demo@afirmativepill.co')
       ON CONFLICT (id) DO NOTHING`,
      [config.demoPatientId],
    );
    await tx.query(
      `INSERT INTO carts (patient_id) VALUES ($1) ON CONFLICT (patient_id) WHERE NOT checked_out DO NOTHING`,
      [config.demoPatientId],
    );
    return {};
  });

  await pool.query('REFRESH MATERIALIZED VIEW medication_catalog');
  const [{ count }] = (await pool.query('SELECT count(*)::int AS count FROM medication_catalog')).rows;
  console.log(`✓ proyección medication_catalog con ${count} medicamentos`);
}

try {
  await migrate();
  await seed();
  console.log('✓ Base de datos lista');
} catch (err) {
  console.error('✗ Error configurando la base de datos:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
