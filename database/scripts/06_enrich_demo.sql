-- EcoPredict AI - Enriquecimiento realista de datos de demostración
-- Inserta series sintéticas creíbles (clima costero peruano) en todas las
-- combinaciones estacion x variable, con solo 3 outliers que generan alertas.
-- Idempotente: elimina primero las mediciones demo y sus alertas.

BEGIN;

-- 1. Limpiar datos demo previos y las alertas asociadas.
DELETE FROM alerts
WHERE measurement_id IN (
  SELECT id FROM measurements WHERE source_type = 'demo'
);
DELETE FROM measurements WHERE source_type = 'demo';

-- 2. Serie realista de 30 dias para todas las combinaciones.
-- Valores basados en condiciones tipicas de costa norte peruana (Trujillo).
INSERT INTO measurements (site_id, variable_id, user_id, value, measured_at, source_type, quality_status, notes)
WITH params AS (
  SELECT
    s.id AS site_id,
    v.id AS variable_id,
    -- Base por variable (valor central realista).
    CASE v.code
      WHEN 'PM25'  THEN 18.0
      WHEN 'PM10'  THEN 40.0
      WHEN 'PH'    THEN 7.8
      WHEN 'TURB'  THEN 18.0
      WHEN 'WTEMP' THEN 22.0
      WHEN 'TEMP'  THEN 22.5
      WHEN 'HUM'   THEN 78.0
    END AS base,
    -- Variabilidad diaria realista (amplitud).
    CASE v.code
      WHEN 'PM25'  THEN 8.0
      WHEN 'PM10'  THEN 15.0
      WHEN 'PH'    THEN 0.4
      WHEN 'TURB'  THEN 10.0
      WHEN 'WTEMP' THEN 2.0
      WHEN 'TEMP'  THEN 3.0
      WHEN 'HUM'   THEN 8.0
    END AS amp,
    -- Sesgo por combinacion estacion x variable (fraccion de la amplitud).
    -- Cada estacion tiene un perfil distinto segun la variable para que el
    -- heatmap muestre variacion real dentro de cada fila (no un solo color).
    CASE
      -- Referencia: neutro en todas las variables.
      WHEN s.id = 1 THEN 0.0
      -- Centro Urbano: mas particulado y calor (isla de calor), humedad alta, agua normal.
      WHEN s.id = 2 AND v.code = 'PM25'  THEN  0.4
      WHEN s.id = 2 AND v.code = 'PM10'  THEN  0.4
      WHEN s.id = 2 AND v.code = 'TEMP'  THEN  0.5
      WHEN s.id = 2 AND v.code = 'HUM'   THEN  0.5
      WHEN s.id = 2 AND v.code = 'PH'    THEN  0.1
      WHEN s.id = 2 AND v.code = 'TURB'  THEN  0.2
      WHEN s.id = 2 AND v.code = 'WTEMP' THEN  0.3
      -- Cuenca Rio Moche: poco particulado, fresco, pH mas bajo, turbidez alta por sedimentos.
      WHEN s.id = 3 AND v.code = 'PM25'  THEN -0.6
      WHEN s.id = 3 AND v.code = 'PM10'  THEN -0.5
      WHEN s.id = 3 AND v.code = 'TEMP'  THEN -0.6
      WHEN s.id = 3 AND v.code = 'HUM'   THEN  0.4
      WHEN s.id = 3 AND v.code = 'PH'    THEN -0.6
      WHEN s.id = 3 AND v.code = 'TURB'  THEN  0.8
      WHEN s.id = 3 AND v.code = 'WTEMP' THEN -0.5
      -- Parque Industrial: mucho particulado, caluroso y seco; agua algo mas calida.
      WHEN s.id = 4 AND v.code = 'PM25'  THEN  1.2
      WHEN s.id = 4 AND v.code = 'PM10'  THEN  1.1
      WHEN s.id = 4 AND v.code = 'TEMP'  THEN  0.8
      WHEN s.id = 4 AND v.code = 'HUM'   THEN -0.3
      WHEN s.id = 4 AND v.code = 'PH'    THEN  0.2
      WHEN s.id = 4 AND v.code = 'TURB'  THEN  0.3
      WHEN s.id = 4 AND v.code = 'WTEMP' THEN  0.6
      ELSE 0.0
    END AS bias,
    v.min_value,
    v.max_value
  FROM monitoring_sites s
  CROSS JOIN environmental_variables v
)
SELECT
  p.site_id,
  p.variable_id,
  1,
  LEAST(p.max_value, GREATEST(p.min_value,
    (p.base + p.bias * p.amp * 0.6
       + sin(gs.n / 3.5) * p.amp * 0.4
       + (random() - 0.5) * p.amp * 0.3
    )
  ))::numeric(18,5) AS value,
  date_trunc('day', now()) - (gs.n || ' days')::interval,
  'demo',
  'valid',
  'Serie sintetica realista de demostracion'
FROM params p
CROSS JOIN generate_series(1, 30) AS gs(n)
ON CONFLICT (site_id, variable_id, measured_at) DO NOTHING;

-- 3. Tres outliers que disparan exactamente 3 alertas.
--    a) PM2.5 critico en parque industrial (> 50)
--    b) pH critico en cuenca del rio (< 6)
--    c) Turbidez advertencia en cuenca del rio (> 100)
INSERT INTO measurements (site_id, variable_id, user_id, value, measured_at, source_type, quality_status, notes)
VALUES
  (4, 1, 1,  58.0, date_trunc('day', now()) - interval '32 days', 'demo', 'valid', 'Evento de alta contaminacion particulada'),
  (3, 3, 1,   5.4, date_trunc('day', now()) - interval '33 days', 'demo', 'valid', 'Descarga acida puntual en rio'),
  (3, 4, 1, 135.0, date_trunc('day', now()) - interval '34 days', 'demo', 'valid', 'Turbidez elevada por arrastre de sedimentos')
ON CONFLICT (site_id, variable_id, measured_at) DO NOTHING;

-- 4. Recalcular anomaly_score (z-score robusto por combinacion).
WITH medians AS (
  SELECT site_id, variable_id,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS med
  FROM measurements
  GROUP BY site_id, variable_id
),
mads AS (
  SELECT m.site_id, m.variable_id,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(m.value - md.med)) AS mad
  FROM measurements m
  JOIN medians md ON md.site_id = m.site_id AND md.variable_id = m.variable_id
  GROUP BY m.site_id, m.variable_id
),
scored AS (
  SELECT
    m.id,
    LEAST(5.0, GREATEST(-5.0,
      (m.value - md.med) / NULLIF(1.4826 * ad.mad, 0)
    ))::numeric(8,4) AS score
  FROM measurements m
  JOIN medians md ON md.site_id = m.site_id AND md.variable_id = m.variable_id
  JOIN mads ad ON ad.site_id = m.site_id AND ad.variable_id = m.variable_id
)
UPDATE measurements m
SET anomaly_score = s.score
FROM scored s
WHERE m.id = s.id;

-- 5. Generar alertas para las 3 mediciones extremas.
INSERT INTO alerts (rule_id, measurement_id, site_id, variable_id, value, severity, message)
SELECT
  ar.id,
  m.id,
  m.site_id,
  m.variable_id,
  m.value,
  ar.severity,
  CASE
    WHEN ar.min_threshold IS NOT NULL AND m.value < ar.min_threshold
      THEN 'Valor ' || m.value || ' por debajo del minimo configurado (' || ar.min_threshold || ')'
    WHEN ar.max_threshold IS NOT NULL AND m.value > ar.max_threshold
      THEN 'Valor ' || m.value || ' por encima del maximo configurado (' || ar.max_threshold || ')'
  END
FROM measurements m
JOIN alert_rules ar
  ON ar.variable_id = m.variable_id
 AND (ar.site_id IS NULL OR ar.site_id = m.site_id)
 AND ar.enabled = true
WHERE
  m.source_type = 'demo'
  AND (
    (ar.min_threshold IS NOT NULL AND m.value < ar.min_threshold)
    OR
    (ar.max_threshold IS NOT NULL AND m.value > ar.max_threshold)
  )
  AND NOT EXISTS (
    SELECT 1 FROM alerts a
    WHERE a.rule_id = ar.id AND a.measurement_id = m.id
  );

COMMIT;
