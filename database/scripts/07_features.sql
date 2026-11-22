-- EcoPredict AI - Mejoras P0/P1/P2 (segunda iteración)
-- Ejecutar sobre ecopredict_db DESPUÉS de 05_improvements.sql.
-- Idempotente: puede ejecutarse varias veces sin error.

BEGIN;

-- P1 (#21): umbrales de referencia / normativa, versionados y con fuente citada.
-- No sustituyen a las reglas de alerta operativas; son contexto normativo trazable.
CREATE TABLE IF NOT EXISTS reference_thresholds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variable_id BIGINT NOT NULL REFERENCES environmental_variables(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  min_value NUMERIC(18,5),
  max_value NUMERIC(18,5),
  source TEXT NOT NULL,
  source_url TEXT,
  jurisdiction TEXT,
  valid_from DATE,
  valid_to DATE,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
CREATE INDEX IF NOT EXISTS ix_reference_thresholds_variable ON reference_thresholds(variable_id, is_active);

-- P1 (#17): registro de notificaciones de alertas críticas (webhook/email/log).
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id BIGINT REFERENCES alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('webhook','email','log')),
  target TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_alert ON notifications(alert_id);

-- Umbrales de referencia ilustrativos (fuente citada). NO son límites legales:
-- ajustar según la norma aplicable y la promediación requerida. Idempotente por (variable,label,version).
INSERT INTO reference_thresholds (variable_id, label, min_value, max_value, source, source_url, jurisdiction, version)
SELECT v.id, r.label, r.min_t, r.max_t, r.source, r.source_url, r.jurisdiction, 1
FROM (VALUES
  ('PM25', 'Directriz OMS - media anual',  NULL::numeric, 5::numeric,   'OMS 2021 (Global air quality guidelines)', 'https://www.who.int/publications/i/item/9789240034228', 'Internacional'),
  ('PM25', 'Directriz OMS - media 24h',    NULL::numeric, 15::numeric,  'OMS 2021 (Global air quality guidelines)', 'https://www.who.int/publications/i/item/9789240034228', 'Internacional'),
  ('PM10', 'Directriz OMS - media 24h',    NULL::numeric, 45::numeric,  'OMS 2021 (Global air quality guidelines)', 'https://www.who.int/publications/i/item/9789240034228', 'Internacional'),
  ('PH',   'Rango apto para riego',        6.5::numeric,  8.5::numeric, 'FAO - Directrices de calidad de agua para riego', 'https://www.fao.org/3/t0234e/t0234e00.htm', 'Internacional'),
  ('TURB', 'Referencia operativa de potabilización', NULL::numeric, 5::numeric, 'WHO Guidelines for Drinking-water Quality', 'https://www.who.int/publications/i/item/9789240045064', 'Internacional'),
  ('WTEMP','Referencia ecológica acuática', NULL::numeric, 30::numeric, 'Valor orientativo interno', NULL, 'Referencial')
) AS r(code,label,min_t,max_t,source,source_url,jurisdiction)
JOIN environmental_variables v ON v.code = r.code
WHERE NOT EXISTS (
  SELECT 1 FROM reference_thresholds rt
  WHERE rt.variable_id = v.id AND rt.label = r.label AND rt.version = 1
);

COMMIT;
