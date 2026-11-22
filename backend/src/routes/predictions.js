import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { forecast, analyzeRegularity } from '../ai/forecast.js';

const r = Router();
r.use(authenticate);

// Historial de ejecuciones. Las predicciones multi-paso se agregan en un único
// arreglo JSON para no duplicar filas del run (corrige A1).
r.get(
  '/',
  wrap(async (req, res) => {
    const rows = (
      await query(
        `SELECT pr.id, pr.user_id, pr.site_id, pr.variable_id, pr.model_name, pr.model_version,
                pr.metrics, pr.training_rows, pr.testing_rows, pr.executed_at,
                s.name AS site_name, v.name AS variable_name, v.unit,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', p.id, 'predicted_value', p.predicted_value,
                    'target_date', p.target_date, 'horizon_step', p.horizon_step
                  ) ORDER BY p.horizon_step)
                  FROM predictions p WHERE p.run_id = pr.id
                ), '[]'::json) AS predictions,
                (SELECT p.predicted_value FROM predictions p WHERE p.run_id = pr.id ORDER BY p.horizon_step LIMIT 1) AS predicted_value,
                (SELECT p.target_date FROM predictions p WHERE p.run_id = pr.id ORDER BY p.horizon_step LIMIT 1) AS target_date
         FROM prediction_runs pr
         JOIN monitoring_sites s ON s.id = pr.site_id
         JOIN environmental_variables v ON v.id = pr.variable_id
         ORDER BY pr.executed_at DESC
         LIMIT 100`
      )
    ).rows;
    res.json(rows);
  })
);

// Ejecuta el pronóstico multi-paso con evaluación temporal y walk-forward.
r.post(
  '/run',
  wrap(async (req, res) => {
    const d = z
      .object({
        site_id: z.coerce.number().int().positive(),
        variable_id: z.coerce.number().int().positive(),
        horizon: z.coerce.number().int().min(1).max(12).default(3),
        folds: z.coerce.number().int().min(3).max(10).default(5),
      })
      .parse(req.body);

    const q = await query(
      "SELECT value::float8, measured_at FROM measurements WHERE site_id=$1 AND variable_id=$2 AND quality_status='valid' ORDER BY measured_at ASC, id ASC",
      [d.site_id, d.variable_id]
    );
    if (q.rows.length < 30)
      throw new HttpError(422, 'Requiere al menos 30 observaciones válidas de la misma estación y variable');

    const samples = q.rows.map((x) => Number(x.value));
    const dates = q.rows.map((x) => new Date(x.measured_at).getTime());
    const regularity = analyzeRegularity(dates);
    if (!regularity.medianStepMs || !Number.isFinite(regularity.medianStepMs))
      throw new HttpError(422, 'Fechas de medición insuficientemente variadas');

    let result;
    try {
      result = forecast(samples, { horizon: d.horizon, folds: d.folds });
    } catch (e) {
      throw new HttpError(422, e.message);
    }

    const step = regularity.medianStepMs;
    const lastTs = dates.at(-1);

    const out = await tx(async (c) => {
      const run = await c.query(
        `INSERT INTO prediction_runs(user_id,site_id,variable_id,model_name,model_version,metrics,training_rows,testing_rows)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          req.user.id,
          d.site_id,
          d.variable_id,
          'ridge_lag3',
          '2.0.0',
          JSON.stringify({
            model: result.metrics,
            baseline: result.baseline,
            suitable: result.suitable,
            method: result.method,
            forecast_step_ms: step,
            horizon: d.horizon,
            interval: result.interval,
            intervalPath: result.intervalPath,
            holdout: result.holdout,
            residualDiagnostics: result.residualDiagnostics,
            autocorrelation: result.autocorrelation,
            partialAutocorrelation: result.partialAutocorrelation,
            crossValidation: result.crossValidation,
            featureImportance: result.featureImportance,
            regularity,
          }),
          result.trainingRows,
          result.testingRows,
        ]
      );
      const inserts = [];
      for (let i = 0; i < result.forecastPath.length; i++) {
        const target = new Date(lastTs + step * (i + 1));
        const pred = await c.query(
          `INSERT INTO predictions(run_id,site_id,variable_id,predicted_value,target_date,horizon_step)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [run.rows[0].id, d.site_id, d.variable_id, result.forecastPath[i], target, i + 1]
        );
        inserts.push(pred.rows[0]);
      }
      await c.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)', [
        req.user.id,
        'RUN_PREDICTION',
        'prediction_runs',
        run.rows[0].id,
        JSON.stringify({ horizon: d.horizon }),
      ]);
      return { run: run.rows[0], predictions: inserts };
    });

    const warnings = [];
    if (!result.suitable) warnings.push('El modelo NO supera el baseline; no apto para decisiones operativas');
    if (!regularity.isRegular)
      warnings.push('Muestreo irregular: el horizonte temporal proyectado es aproximado');

    res.status(201).json({
      ...out,
      suitable: result.suitable,
      warning: result.suitable ? 'Estimación estadística, no alerta oficial' : warnings[0],
      warnings,
      regularity,
    });
  })
);

export default r;
