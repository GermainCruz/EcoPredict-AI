INSERT INTO roles(name,description) VALUES ('admin','Administración total'),('user','Registro y consulta') ON CONFLICT(name) DO NOTHING;
INSERT INTO environmental_variables(code,name,category,unit,min_value,max_value,reference_value,reference_context) VALUES
('PM25','Partículas PM2.5','air','µg/m³',0,2000,NULL,'Los umbrales deben configurarse según norma y promediación'),
('PM10','Partículas PM10','air','µg/m³',0,3000,NULL,'Sin umbral legal precargado'),
('PH','Potencial de hidrógeno','water','pH',0,14,NULL,'Depende del uso del agua'),
('TURB','Turbidez','water','NTU',0,10000,NULL,'Depende del uso del agua'),
('WTEMP','Temperatura del agua','water','°C',-10,100,NULL,NULL),
('TEMP','Temperatura ambiental','weather','°C',-90,70,NULL,NULL),
('HUM','Humedad relativa','weather','%',0,100,NULL,NULL)
ON CONFLICT(code) DO NOTHING;
INSERT INTO monitoring_sites(name,latitude,longitude,description) VALUES ('Estación de referencia',-8.111600,-79.028700,'Ubicación de ejemplo; NO corresponde a un sensor instalado') ON CONFLICT(name) DO NOTHING;
