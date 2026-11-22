import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { spcLimits, mannKendall } from '../ai/forecast.js';

const r = Router();
r.use(authenticate);

const num = z.coerce.number().int().positive();

async function seriesFor(runner, site_id, variable_id) {
  return (
    await runner.query(
      `SELECT date_trunc('day', measured_at) AS date,
              round(avg(value), 4)::float8 AS value,
              count(*)::int AS samples
       FROM measurements
       WHERE site_id = $1 AND variable_id = $2 AND quality_status = 'valid'
       GROUP BY 1 ORDER BY 1`,
      [site_id, variable_id]
    )
  ).rows;
}

// P1 #10 / #15: serie diaria con límites de control (SPC) y test de Mann-Kendall.
r.get(
  '/trend',
  wrap(async (req, res) => {
    const f = z.object({ site_id: num, variable_id: num }).parse(req.query);
    const series = await seriesFor({ query }, f.site_id, f.variable_id);
    const values = series.map((x) => x.value);
    const variable = (
      await query('SELECT id, code, name, unit FROM environmental_variables WHERE id = $1', [f.variable_id])
    ).rows[0];
    if (!variable) throw new HttpError(404, 'Variable inexistente');
    const reference = (
      await query(
        `SELECT id, label, min_value::float8 AS min_value, max_value::float8 AS max_value,
                source, is_active
         FROM reference_thresholds
         WHERE variable_id = $1 AND is_active = true
         ORDER BY label`,
        [f.variable_id]
      )
    ).rows;
    res.json({
      variable,
      series,
      spc: spcLimits(values),
      trend: mannKendall(values),
      reference,
    });
  })
);

// P1 #11: comparación normalizada. Se compara una misma variable entre varias
// estaciones (?variable_id + site_ids) o varias variables de una estación (?site_id + variable_ids).
r.get(
  '/comparison',
  wrap(async (req, res) => {
    const f = z
      .object({
        variable_id: z.coerce.number().int().positive().optional(),
        site_id: z.coerce.number().int().positive().optional(),
        site_ids: z.string().optional(),
        variable_ids: z.string().optional(),
      })
      .parse(req.query);

    const parseIds = (s) =>
      (s || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0);

    const out = [];

    if (f.variable_id && parseIds(f.site_ids).length) {
      const ids = parseIds(f.site_ids);
      const variable = (await query('SELECT * FROM environmental_variables WHERE id = $1', [f.variable_id])).rows[0];
      if (!variable) throw new HttpError(404, 'Variable inexistente');
      const sites = (
        await query('SELECT id, name FROM monitoring_sites WHERE id = ANY($1::bigint[])', [ids])
      ).rows;
      for (const site of sites) {
        const points = await seriesFor({ query }, site.id, f.variable_id);
        out.push({ key: `s${site.id}`, label: site.name, unit: variable.unit, points, stats: statsOf(points) });
      }
    } else if (f.site_id && parseIds(f.variable_ids).length) {
      const ids = parseIds(f.variable_ids);
      const site = (await query('SELECT id, name FROM monitoring_sites WHERE id = $1', [f.site_id])).rows[0];
      if (!site) throw new HttpError(404, 'Estación inexistente');
      const variables = (
        await query('SELECT id, name, unit FROM environmental_variables WHERE id = ANY($1::bigint[])', [ids])
      ).rows;
      for (const v of variables) {
        const points = await seriesFor({ query }, f.site_id, v.id);
        out.push({ key: `v${v.id}`, label: v.name, unit: v.unit, points, stats: statsOf(points) });
      }
    } else {
      throw new HttpError(422, 'Indica variable_id + site_ids, o site_id + variable_ids');
    }

    res.json({ series: out });
  })
);

function statsOf(points) {
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (!values.length) return { n: 0, mean: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return { n: values.length, mean: Number(mean.toFixed(4)), sd: Number(sd.toFixed(4)) };
}

// P1 #12: distribución (boxplot) de una variable por estación (misma unidad).
r.get(
  '/distributions',
  wrap(async (req, res) => {
    const f = z.object({ variable_id: num }).parse(req.query);
    const variable = (
      await query('SELECT id, name, unit FROM environmental_variables WHERE id = $1', [f.variable_id])
    ).rows[0];
    if (!variable) throw new HttpError(404, 'Variable inexistente');
    const rows = (
      await query(
        `SELECT s.name AS label,
                count(*)::int AS n,
                min(m.value)::float8 AS min,
                max(m.value)::float8 AS max,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY m.value)::float8 AS q1,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY m.value)::float8 AS median,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY m.value)::float8 AS q3,
                avg(m.value)::float8 AS mean
         FROM measurements m
         JOIN monitoring_sites s ON s.id = m.site_id
         WHERE m.variable_id = $1 AND m.quality_status = 'valid'
         GROUP BY s.name ORDER BY s.name`,
        [f.variable_id]
      )
    ).rows;
    res.json({ variable, groups: rows });
  })
);

// P1 #14: patrón temporal (día de la semana × hora) de una estación y variable.
r.get(
  '/temporal-heatmap',
  wrap(async (req, res) => {
    const f = z.object({ site_id: num, variable_id: num }).parse(req.query);
    const rows = (
      await query(
        `SELECT EXTRACT(DOW FROM measured_at)::int AS dow,
                EXTRACT(HOUR FROM measured_at)::int AS hour,
                round(avg(value), 4)::float8 AS value,
                count(*)::int AS n
         FROM measurements
         WHERE site_id = $1 AND variable_id = $2 AND quality_status = 'valid'
         GROUP BY 1, 2 ORDER BY 1, 2`,
        [f.site_id, f.variable_id]
      )
    ).rows;
    const values = rows.map((x) => x.value).filter((v) => Number.isFinite(v));
    res.json({
      cells: rows,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    });
  })
);

export default r;
