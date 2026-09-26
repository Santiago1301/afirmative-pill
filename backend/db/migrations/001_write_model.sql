-- =====================================================================
-- Afirmative Pill — WRITE MODEL (lado de comandos de CQRS)
-- Tablas normalizadas y transaccionales. Solo los command handlers
-- escriben aquí. Las invariantes críticas se protegen también en la BD.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE prescription_status AS ENUM ('NOT_REQUIRED', 'SUBMITTED', 'VALIDATED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Catálogo (normalizado) ----------
CREATE TABLE IF NOT EXISTS categories (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS manufacturers (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS medications (
  id                     SERIAL PRIMARY KEY,
  sku                    TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  active_ingredient      TEXT NOT NULL,
  category_id            INT  NOT NULL REFERENCES categories(id),
  manufacturer_id        INT  NOT NULL REFERENCES manufacturers(id),
  dosage                 TEXT NOT NULL,
  presentation           TEXT NOT NULL,
  price                  INT  NOT NULL CHECK (price > 0),          -- COP, sin decimales
  stock                  INT  NOT NULL CHECK (stock >= 0),         -- invariante: nunca negativo
  requires_prescription  BOOLEAN NOT NULL DEFAULT FALSE,
  description            TEXT NOT NULL DEFAULT '',
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Pacientes ----------
CREATE TABLE IF NOT EXISTS patients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    TEXT NOT NULL,
  document_id  TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Carrito (agregado de escritura) ----------
CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID NOT NULL REFERENCES patients(id),
  checked_out BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un único carrito activo por paciente
CREATE UNIQUE INDEX IF NOT EXISTS ux_carts_active_patient ON carts(patient_id) WHERE NOT checked_out;

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id        UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  medication_id  INT  NOT NULL REFERENCES medications(id),
  quantity       INT  NOT NULL CHECK (quantity > 0),
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, medication_id)
);

-- ---------- Órdenes (agregado de escritura) ----------
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           UUID NOT NULL REFERENCES patients(id),
  status               order_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  prescription_status  prescription_status NOT NULL DEFAULT 'NOT_REQUIRED',
  cancel_reason        TEXT,
  version              INT NOT NULL DEFAULT 1,                     -- control de concurrencia optimista
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_orders_patient ON orders(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  medication_id  INT  NOT NULL REFERENCES medications(id),
  quantity       INT  NOT NULL CHECK (quantity > 0),
  unit_price     INT  NOT NULL CHECK (unit_price > 0),            -- precio congelado al momento de la compra
  PRIMARY KEY (order_id, medication_id)
);
CREATE INDEX IF NOT EXISTS ix_order_items_medication ON order_items(medication_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  doctor_name      TEXT NOT NULL,
  doctor_license   TEXT NOT NULL,
  issued_at        DATE NOT NULL,
  diagnosis        TEXT,
  document_url     TEXT,
  rejection_reason TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ
);

-- ---------- Outbox de eventos de dominio ----------
-- Cada comando escribe su evento EN LA MISMA TRANSACCIÓN que el cambio de estado.
-- Workers asíncronos lo consumen para actualizar proyecciones y avanzar el flujo.
CREATE TABLE IF NOT EXISTS domain_events (
  id            BIGSERIAL PRIMARY KEY,
  aggregate_id  UUID NOT NULL,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  projected_at  TIMESTAMPTZ,   -- consumido por el proyector de lectura
  handled_at    TIMESTAMPTZ    -- consumido por el process manager (validación/aprobación)
);
CREATE INDEX IF NOT EXISTS ix_events_unprojected ON domain_events(id) WHERE projected_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_events_unhandled   ON domain_events(id) WHERE handled_at IS NULL;
