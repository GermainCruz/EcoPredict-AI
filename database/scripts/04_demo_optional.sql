-- DATOS TOTALMENTE SINTÉTICOS PARA DEMOSTRACIÓN. NO SON MEDICIONES DE CAMPO.
-- Ejecutar DESPUÉS de npm run seed --prefix backend; no ejecutar sobre base de producción.

-- 1. Estaciones adicionales de demostración
INSERT INTO monitoring_sites(name, latitude, longitude, description) VALUES
('Estación Centro Urbano', -8.111600, -79.028700, 'Zona urbana de monitoreo de calidad del aire y clima (demo)'),
('Estación Cuenca Río Moche', -8.152400, -79.005200, 'Punto de control hidrológico y calidad de agua (demo)'),
('Estación Parque Industrial', -8.075100, -79.048900, 'Zona industrial para seguimiento de material particulado (demo)')
ON CONFLICT(name) DO NOTHING;

-- 2. Serie sintética de Temperatura (TEMP) en Estación de referencia (45 días)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((21 + n*0.08 + sin(n/4.0)*1.2)::numeric,3),
       TIMESTAMPTZ '2026-08-01 12:00:00-05' + (n || ' days')::interval,
       'demo',
       CASE WHEN n IN (17, 33) THEN 'suspect' ELSE 'valid' END,
       'SERIE SINTÉTICA EDUCATIVA; no representa observación real'
FROM generate_series(0,44) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación de referencia' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='TEMP' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

-- 3. Serie sintética de PM2.5 en Estación Centro Urbano (45 días)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((18.5 + n*0.14 + cos(n/3.0)*3.8)::numeric,3),
       TIMESTAMPTZ '2026-08-01 08:00:00-05' + (n || ' days')::interval,
       'demo',
       CASE WHEN n = 28 THEN 'suspect' ELSE 'valid' END,
       'Serie demostrativa PM2.5 zona urbana'
FROM generate_series(0,44) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Centro Urbano' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='PM25' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

-- 4. Serie sintética de PM10 en Estación Parque Industrial (40 días)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((42.0 + n*0.22 + sin(n/2.5)*6.5)::numeric,3),
       TIMESTAMPTZ '2026-08-05 09:00:00-05' + (n || ' days')::interval,
       'demo',
       CASE WHEN n IN (12, 31) THEN 'suspect' ELSE 'valid' END,
       'Serie demostrativa PM10 zona industrial'
FROM generate_series(0,39) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Parque Industrial' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='PM10' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

-- 5. Serie sintética de pH y Turbidez en Estación Cuenca Río Moche (40 días cada una)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((7.15 + sin(n/5.0)*0.35 + (n%4)*0.04)::numeric,3),
       TIMESTAMPTZ '2026-08-05 10:30:00-05' + (n || ' days')::interval,
       'demo','valid','Serie demostrativa calidad de agua - pH'
FROM generate_series(0,39) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Cuenca Río Moche' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='PH' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((12.4 + n*0.18 + abs(sin(n/3.0))*4.2)::numeric,3),
       TIMESTAMPTZ '2026-08-05 10:45:00-05' + (n || ' days')::interval,
       'demo',
       CASE WHEN n = 22 THEN 'suspect' ELSE 'valid' END,
       'Serie demostrativa calidad de agua - Turbidez'
FROM generate_series(0,39) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Cuenca Río Moche' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='TURB' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

-- 6. Serie sintética de Temperatura del agua (WTEMP) en Estación Cuenca Río Moche (40 días)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((19.2 + n*0.05 + sin(n/4.0)*0.9)::numeric,3),
       TIMESTAMPTZ '2026-08-05 11:00:00-05' + (n || ' days')::interval,
       'demo','valid','Serie demostrativa calidad de agua - Temperatura del agua'
FROM generate_series(0,39) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Cuenca Río Moche' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='WTEMP' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);

-- 7. Serie sintética de Humedad relativa (HUM) en Estación Centro Urbano (40 días)
INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,source_type,quality_status,notes)
SELECT s.id,v.id,u.id,round((68.0 + cos(n/4.0)*8.5)::numeric,3),
       TIMESTAMPTZ '2026-08-05 14:00:00-05' + (n || ' days')::interval,
       'demo','valid','Serie demostrativa humedad relativa'
FROM generate_series(0,39) AS n
CROSS JOIN LATERAL (SELECT id FROM monitoring_sites WHERE name='Estación Centro Urbano' LIMIT 1) s
CROSS JOIN LATERAL (SELECT id FROM environmental_variables WHERE code='HUM' LIMIT 1) v
CROSS JOIN LATERAL (SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.site_id = s.id AND m.variable_id = v.id AND m.source_type = 'demo'
);
