import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { query, tx, pool } from './config/db.js';
import { forecast } from './ai/forecast.js';
import { applyRuleToHistory } from './services/alerts.js';

const DEMO_USERS = [
  { full_name: 'Germain (Admin)', email: 'germain@ecopredict.local', role: 'admin' },
  { full_name: 'Luis (Ambiental)', email: 'luis@ecopredict.local', role: 'user' },
  { full_name: 'Renato (Reportes)', email: 'renato@ecopredict.local', role: 'user' },
  { full_name: 'Tania (IA)', email: 'tania@ecopredict.local', role: 'admin' },
];

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'EcoPredict2026!';

async function seedUsers() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  let created = 0;
  for (const u of DEMO_USERS) {
    const res = await query(
      `INSERT INTO users(role_id, full_name, email, password_hash)
       VALUES ((SELECT id FROM roles WHERE name=$1), $2, lower($3), $4)
       ON CONFLICT(email) DO NOTHING
       RETURNING id`,
      [u.role, u.full_name, u.email, hash]
    );
    created += res.rowCount;
  }
  console.log(`Usuarios demo procesados (${created} nuevos).`);
}

async function seedDemoSql() {
  const sqlPath = path.resolve('..', 'database', 'scripts', '04_demo_optional.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await query(sql);
  console.log('Estaciones y series de mediciones demo cargadas.');
}

async function shiftDemoDatesToNow() {
  const maxRes = await query("SELECT max(measured_at) as max_date FROM measurements WHERE source_type = 'demo'");
  if (maxRes.rows[0]?.max_date) {
    const maxDate = new Date(maxRes.rows[0].max_date).getTime();
    const now = Date.now();
    const diffMs = now - maxDate;
    if (diffMs > 86400000) {
      await query(
        `UPDATE measurements
         SET measured_at = measured_at + ($1 || ' milliseconds')::interval
         WHERE source_type = 'demo'`,
        [diffMs]
      );
      console.log('Fechas de mediciones demo actualizadas para alinearse con la fecha actual.');
    }
  }
}

async function seedAlerts() {
  // Asegurar reglas alineadas a umbrales normativos ECA (ej. PM2.5 = 25 µg/m³, PM10 = 100 µg/m³, TURB = 18 UNT)
  const pm25Var = await query("SELECT id FROM environmental_variables WHERE code = 'PM25'");
  if (pm25Var.rows.length) {
    const exist = await query("SELECT 1 FROM alert_rules WHERE variable_id = $1 AND max_threshold = 25.0", [pm25Var.rows[0].id]);
    if (!exist.rows.length) {
      await query(
        `INSERT INTO alert_rules (site_id, variable_id, min_threshold, max_threshold, severity, enabled)
         VALUES (NULL, $1, NULL, 25.0, 'warning', true)`,
        [pm25Var.rows[0].id]
      );
    }
  }

  const turbVar = await query("SELECT id FROM environmental_variables WHERE code = 'TURB'");
  if (turbVar.rows.length) {
    const exist = await query("SELECT 1 FROM alert_rules WHERE variable_id = $1 AND max_threshold = 18.0", [turbVar.rows[0].id]);
    if (!exist.rows.length) {
      await query(
        `INSERT INTO alert_rules (site_id, variable_id, min_threshold, max_threshold, severity, enabled)
         VALUES (NULL, $1, NULL, 18.0, 'warning', true)`,
        [turbVar.rows[0].id]
      );
    }
  }

  // Insertar un par de picos demostrativos recientes para activar alertas en el Dashboard
  const userRes = await query("SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1");
  const userId = userRes.rows[0]?.id;
  if (userId) {
    await query(
      `INSERT INTO measurements(site_id, variable_id, user_id, value, measured_at, source_type, quality_status, notes)
       SELECT s.id, v.id, $1, 118.5, now() - interval '2 hours', 'demo', 'suspect', 'Pico anómalo detectado por tráfico/industria'
       FROM monitoring_sites s, environmental_variables v
       WHERE s.name = 'Estación Parque Industrial' AND v.code = 'PM10'
       ON CONFLICT (site_id, variable_id, measured_at) DO NOTHING`,
      [userId]
    );

    // Regla para PM10 a 100 µg/m³ (ECA Aire)
    const pm10Var = await query("SELECT id FROM environmental_variables WHERE code = 'PM10'");
    if (pm10Var.rows.length) {
      const exist = await query("SELECT 1 FROM alert_rules WHERE variable_id = $1 AND max_threshold = 100.0", [pm10Var.rows[0].id]);
      if (!exist.rows.length) {
        await query(
          `INSERT INTO alert_rules (site_id, variable_id, min_threshold, max_threshold, severity, enabled)
           VALUES (NULL, $1, NULL, 100.0, 'critical', true)`,
          [pm10Var.rows[0].id]
        );
      }
    }
  }

  const rules = (await query('SELECT * FROM alert_rules WHERE enabled = true')).rows;
  let created = 0;
  for (const rule of rules) {
    const alerts = await applyRuleToHistory({ query }, rule, { limit: 500 });
    created += alerts.length;
  }
  console.log(`Alertas demo generadas (${created} incidencias según reglas ambientales activas).`);
}

async function seedSamplePredictions() {
  const pairs = [
    { site: 'Estación de referencia', code: 'TEMP' },
    { site: 'Estación Centro Urbano', code: 'PM25' },
    { site: 'Estación Parque Industrial', code: 'PM10' },
    { site: 'Estación Cuenca Río Moche', code: 'PH' },
  ];

  const userRes = await query("SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1");
  const userId = userRes.rows[0]?.id;
  if (!userId) return;

  let generated = 0;
  for (const pair of pairs) {
    const meta = await query(
      `SELECT s.id AS site_id, v.id AS variable_id
       FROM monitoring_sites s, environmental_variables v
       WHERE s.name=$1 AND v.code=$2`,
      [pair.site, pair.code]
    );
    if (!meta.rows.length) continue;
    const { site_id, variable_id } = meta.rows[0];

    // Verificar si ya existe una predicción para este par
    const existCheck = await query(
      'SELECT count(*)::int AS c FROM prediction_runs WHERE site_id=$1 AND variable_id=$2',
      [site_id, variable_id]
    );
    if (existCheck.rows[0].c > 0) continue;

    const q = await query(
      `SELECT value::float8, measured_at
       FROM measurements
       WHERE site_id=$1 AND variable_id=$2 AND quality_status='valid'
       ORDER BY measured_at ASC, id ASC`,
      [site_id, variable_id]
    );
    if (q.rows.length < 30) continue;

    const samples = q.rows.map((x) => Number(x.value));
    const result = forecast(samples, { horizon: 3, folds: 5 });
    const dates = q.rows.map((x) => new Date(x.measured_at).getTime());
    const steps = dates.slice(1).map((v, i) => v - dates[i]).filter((v) => v > 0).sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)] || 86400000;
    const lastDate = dates.at(-1) || Date.now();

    await tx(async (c) => {
      const run = await c.query(
        `INSERT INTO prediction_runs(user_id,site_id,variable_id,model_name,model_version,metrics,training_rows,testing_rows)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          userId,
          site_id,
          variable_id,
          'ridge_lag3',
          '1.0.0',
          JSON.stringify({
            model: result.metrics,
            baseline: result.baseline,
            suitable: result.suitable,
            method: result.method,
            forecast_step_ms: median,
            conformal: result.conformal,
            regularity: result.regularity,
          }),
          result.trainingRows,
          result.testingRows,
        ]
      );

      const runId = run.rows[0].id;
      const forecasts = Array.isArray(result.forecast) ? result.forecast : [result.predicted];
      for (let step = 0; step < forecasts.length; step++) {
        const target = new Date(lastDate + median * (step + 1));
        await c.query(
          `INSERT INTO predictions(run_id,site_id,variable_id,predicted_value,target_date,horizon_step)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [runId, site_id, variable_id, forecasts[step], target, step + 1]
        );
      }

      await c.query(
        `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
         VALUES($1,'RUN_PREDICTION','prediction_runs',$2,$3)`,
        [userId, runId, JSON.stringify({ demo: true, pair })]
      );
      generated++;
    });
  }
  console.log(`Predicciones de demostración generadas (${generated} nuevas corridas).`);
}

try {
  await seedUsers();
  await seedDemoSql();
  await shiftDemoDatesToNow();
  await seedAlerts();
  await seedSamplePredictions();
  console.log('\n¡Datos de demostración cargados exitosamente! El dashboard está listo.');
} finally {
  await pool.end();
}
