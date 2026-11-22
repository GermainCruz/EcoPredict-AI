-- EcoPredict AI - Mejoras P0/P1/P2
-- Ejecutar sobre ecopredict_db DESPUÉS de 02_schema.sql y 03_catalogs.sql.
-- Idempotente: puede ejecutarse varias veces sin error.

BEGIN;

-- A3: unicidad sitio+variable+fecha. Primero se eliminan duplicados exactos
-- conservando la fila más reciente (id mayor).
DELETE FROM measurements m
USING measurements d
WHERE m.site_id = d.site_id
  AND m.variable_id = d.variable_id
  AND m.measured_at = d.measured_at
  AND m.id < d.id;

ALTER TABLE measurements
  DROP CONSTRAINT IF EXISTS uq_measurements_site_variable_time;
ALTER TABLE measurements
  ADD CONSTRAINT uq_measurements_site_variable_time UNIQUE (site_id, variable_id, measured_at);

-- P2: puntaje de anomalía robusto (z-score modificado) para trazabilidad.
ALTER TABLE measurements
  ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC(8,4);

-- P2: paso del horizonte en predicciones multi-paso.
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS horizon_step INTEGER NOT NULL DEFAULT 1;

-- P2: reglas de alerta configurables (independientes de reference_value).
CREATE TABLE IF NOT EXISTS alert_rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id BIGINT REFERENCES monitoring_sites(id) ON DELETE CASCADE,
  variable_id BIGINT NOT NULL REFERENCES environmental_variables(id) ON DELETE CASCADE,
  min_threshold NUMERIC(18,5),
  max_threshold NUMERIC(18,5),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_threshold IS NULL OR max_threshold IS NULL OR min_threshold <= max_threshold)
);
CREATE INDEX IF NOT EXISTS ix_alert_rules_variable ON alert_rules(variable_id, site_id);

-- P2: alertas disparadas por mediciones que cruzan umbrales.
CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id BIGINT REFERENCES alert_rules(id) ON DELETE SET NULL,
  measurement_id BIGINT REFERENCES measurements(id) ON DELETE SET NULL,
  site_id BIGINT NOT NULL REFERENCES monitoring_sites(id),
  variable_id BIGINT NOT NULL REFERENCES environmental_variables(id),
  value NUMERIC(18,5) NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_alerts_status_time ON alerts(status, triggered_at DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_site_variable ON alerts(site_id, variable_id, triggered_at DESC);

-- Reglas de ejemplo (ilustrativas y editables desde la interfaz). Los umbrales
-- NO son límites legales; ajustarlos según la norma aplicable. Solo se insertan
-- si la variable aún no tiene una regla global (idempotente).
INSERT INTO alert_rules (site_id, variable_id, min_threshold, max_threshold, severity, enabled)
SELECT NULL::bigint, v.id, r.min_t, r.max_t, r.severity, true
FROM (VALUES
  ('PH',    6.0::numeric,  9.0::numeric,   'critical'),
  ('TURB',  NULL::numeric, 100.0::numeric, 'warning'),
  ('WTEMP', NULL::numeric, 30.0::numeric,  'warning'),
  ('PM25',  NULL::numeric, 50.0::numeric,  'critical'),
  ('TEMP',  NULL::numeric, 35.0::numeric,  'warning')
) AS r(code, min_t, max_t, severity)
JOIN environmental_variables v ON v.code = r.code
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules ar WHERE ar.variable_id = v.id AND ar.site_id IS NULL
);

COMMIT;
