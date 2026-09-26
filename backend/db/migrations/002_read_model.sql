-- =====================================================================
-- Afirmative Pill — READ MODEL (lado de consultas de CQRS)
-- Proyecciones desnormalizadas y optimizadas para lectura. Las queries
-- GraphQL SOLO leen de aquí; los proyectores (workers) las mantienen.
-- =====================================================================

-- unaccent() no es IMMUTABLE; este wrapper permite usarlo en índices.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ---------- Proyección del catálogo ----------
-- Vista materializada: lectura de una sola tabla, sin JOINs en tiempo de consulta.
-- Se refresca (CONCURRENTLY) cuando el proyector procesa eventos que cambian stock.
DROP MATERIALIZED VIEW IF EXISTS medication_catalog;
CREATE MATERIALIZED VIEW medication_catalog AS
SELECT
  m.id,
  m.sku,
  m.name,
  m.active_ingredient,
  m.category_id,
  c.name  AS category_name,
  m.manufacturer_id,
  mf.name AS manufacturer_name,
  m.dosage,
  m.presentation,
  m.price,
  m.stock,
  m.requires_prescription,
  m.description,
  -- documento de búsqueda normalizado (minúsculas, sin tildes)
  lower(f_unaccent(m.name || ' ' || m.active_ingredient || ' ' || c.name || ' ' || mf.name)) AS search_text,
  now() AS projected_at
FROM medications m
JOIN categories c     ON c.id  = m.category_id
JOIN manufacturers mf ON mf.id = m.manufacturer_id;

CREATE UNIQUE INDEX ux_catalog_id        ON medication_catalog(id);          -- requerido por REFRESH CONCURRENTLY
CREATE UNIQUE INDEX ux_catalog_sku       ON medication_catalog(sku);
CREATE INDEX ix_catalog_category         ON medication_catalog(category_id);
CREATE INDEX ix_catalog_manufacturer     ON medication_catalog(manufacturer_id);
CREATE INDEX ix_catalog_price            ON medication_catalog(price);
CREATE INDEX ix_catalog_rx               ON medication_catalog(requires_prescription);
CREATE INDEX ix_catalog_search_trgm      ON medication_catalog USING gin (search_text gin_trgm_ops);  -- ILIKE '%...%'

-- ---------- Proyección de órdenes ----------
-- Documento listo para pantalla: total, ítems y estado, sin JOINs.
CREATE TABLE IF NOT EXISTS order_summaries (
  order_id             UUID PRIMARY KEY,
  patient_id           UUID NOT NULL,
  status               order_status NOT NULL,
  prescription_status  prescription_status NOT NULL,
  total_amount         INT  NOT NULL,
  item_count           INT  NOT NULL,
  items                JSONB NOT NULL,          -- [{medicationId, quantity, unitPrice, subtotal}]
  status_history       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{status, at, note}]
  status_note          TEXT,
  placed_at            TIMESTAMPTZ NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL,
  last_event_id        BIGINT NOT NULL          -- idempotencia del proyector
);
CREATE INDEX IF NOT EXISTS ix_order_summaries_patient ON order_summaries(patient_id, placed_at DESC);
