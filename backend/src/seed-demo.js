import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { query, tx, pool } from './config/db.js';
import { forecast } from './ai/forecast.js';

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

async function seedSamplePredictions() {
  const existing = await query('SELECT count(*)::int AS c FROM prediction_runs');
  if (existing.rows[0].c > 0) {
    console.log('Ya existen ejecuciones de predicción; se omiten ejemplos adicionales.');
    return;
  }

  const pairs = [
    { site: 'Estación de referencia', code: 'TEMP' },
    { site: 'Estación Centro Urbano', code: 'PM25' },
  ];

  const userRes = await query("SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1");
  const userId = userRes.rows[0]?.id;
  if (!userId) return;

  for (const pair of pairs) {
    const meta = await query(
      `SELECT s.id AS site_id, v.id AS variable_id
       FROM monitoring_sites s, environmental_variables v
       WHERE s.name=$1 AND v.code=$2`,
      [pair.site, pair.code]
    );
    if (!meta.rows.length) continue;
    const { site_id, variable_id } = meta.rows[0];

    const q = await query(
      `SELECT value::float8, measured_at
       FROM measurements
       WHERE site_id=$1 AND variable_id=$2 AND quality_status='valid'
       ORDER BY measured_at ASC, id ASC`,
      [site_id, variable_id]
    );
    if (q.rows.length < 30) continue;

    const samples = q.rows.map((x) => Number(x.value));
    const result = forecast(samples);
    const dates = q.rows.map((x) => new Date(x.measured_at).getTime());
    const steps = dates.slice(1).map((v, i) => v - dates[i]).filter((v) => v > 0).sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)];
    const target = new Date(dates.at(-1) + median);

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
          }),
          result.trainingRows,
          result.testingRows,
        ]
      );
      await c.query(
        `INSERT INTO predictions(run_id,site_id,variable_id,predicted_value,target_date)
         VALUES($1,$2,$3,$4,$5)`,
        [run.rows[0].id, site_id, variable_id, result.predicted, target]
      );
      await c.query(
        `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
         VALUES($1,'RUN_PREDICTION','prediction_runs',$2,$3)`,
        [userId, run.rows[0].id, JSON.stringify({ demo: true, pair })]
      );
    });
  }
  console.log('Predicciones de demostración generadas.');
}

try {
  await seedUsers();
  await seedDemoSql();
  await seedSamplePredictions();
} finally {
  await pool.end();
}
