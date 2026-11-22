import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap } from '../utils/errors.js';

const r = Router();
r.use(authenticate);

// P0 #5: completitud y huecos de muestreo por estación × variable.
r.get(
  '/completeness',
  wrap(async (req, res) => {
    const rows = (
      await query(`
        WITH gaps AS (
          SELECT site_id, variable_id, measured_at,
                 EXTRACT(EPOCH FROM (measured_at - lag(measured_at) OVER (
                   PARTITION BY site_id, variable_id ORDER BY measured_at
                 ))) * 1000 AS gap_ms
          FROM measurements
          WHERE quality_status <> 'rejected'
        ),
        med AS (
          SELECT site_id, variable_id,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms) AS median_step_ms
          FROM gaps WHERE gap_ms IS NOT NULL GROUP BY 1, 2
        ),
        gapagg AS (
          SELECT g.site_id, g.variable_id,
                 m.median_step_ms::float8 AS median_step_ms,
                 count(*) FILTER (WHERE g.gap_ms IS NOT NULL)::int AS intervals,
                 count(*) FILTER (WHERE g.gap_ms > m.median_step_ms * 2)::int AS large_gaps,
                 max(g.gap_ms)::float8 AS max_gap_ms
          FROM gaps g JOIN med m ON m.site_id = g.site_id AND m.variable_id = g.variable_id
          GROUP BY 1, 2, m.median_step_ms
        )
        SELECT b.site_id, b.variable_id, s.name AS site_name, v.name AS variable_name,
               v.code AS variable_code, v.unit,
               b.total, b.valid, b.suspect, b.rejected, b.first_at, b.last_at,
               g.median_step_ms, g.intervals, g.large_gaps, g.max_gap_ms
        FROM (
          SELECT site_id, variable_id,
                 count(*)::int AS total,
                 count(*) FILTER (WHERE quality_status = 'valid')::int AS valid,
                 count(*) FILTER (WHERE quality_status = 'suspect')::int AS suspect,
                 count(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected,
                 min(measured_at) AS first_at, max(measured_at) AS last_at
          FROM measurements GROUP BY 1, 2
        ) b
        JOIN monitoring_sites s ON s.id = b.site_id
        JOIN environmental_variables v ON v.id = b.variable_id
        LEFT JOIN gapagg g ON g.site_id = b.site_id AND g.variable_id = b.variable_id
        ORDER BY s.name, v.name
      `)
    ).rows;

    const items = rows.map((x) => {
      const first = x.first_at ? new Date(x.first_at).getTime() : null;
      const last = x.last_at ? new Date(x.last_at).getTime() : null;
      const spanMs = first !== null && last !== null ? last - first : 0;
      const step = x.median_step_ms || 0;
      const expected = step > 0 ? Math.max(1, Math.round(spanMs / step) + 1) : null;
      const completeness = expected ? Math.min(100, Number(((x.valid / expected) * 100).toFixed(1))) : null;
      return {
        site_id: x.site_id,
        variable_id: x.variable_id,
        site_name: x.site_name,
        variable_name: x.variable_name,
        variable_code: x.variable_code,
        unit: x.unit,
        total: x.total,
        valid: x.valid,
        suspect: x.suspect,
        rejected: x.rejected,
        first_at: x.first_at,
        last_at: x.last_at,
        span_days: spanMs ? Number((spanMs / 86400000).toFixed(1)) : 0,
        median_step_ms: step || null,
        expected,
        completeness,
        large_gaps: x.large_gaps ?? 0,
        max_gap_ms: x.max_gap_ms ?? null,
        suspect_ratio: x.total ? Number(((x.suspect / x.total) * 100).toFixed(1)) : 0,
      };
    });
    res.json({ items });
  })
);

// P0 #13 / P1: revisión de anomalías (puntaje robusto o marca 'suspect').
r.get(
  '/anomalies',
  wrap(async (req, res) => {
    const f = z
      .object({
        site_id: z.coerce.number().int().positive().optional(),
        variable_id: z.coerce.number().int().positive().optional(),
        threshold: z.coerce.number().min(1).max(20).default(3.5),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);

    const rows = (
      await query(
        `SELECT m.id, m.value::float8 AS value, m.measured_at, m.quality_status,
                m.anomaly_score::float8 AS anomaly_score, m.source_type, m.notes,
                s.name AS site_name, v.name AS variable_name, v.code AS variable_code, v.unit
         FROM measurements m
         JOIN monitoring_sites s ON s.id = m.site_id
         JOIN environmental_variables v ON v.id = m.variable_id
         WHERE ($1::bigint IS NULL OR m.site_id = $1)
           AND ($2::bigint IS NULL OR m.variable_id = $2)
           AND (m.quality_status = 'suspect' OR abs(coalesce(m.anomaly_score, 0)) >= $3)
         ORDER BY abs(coalesce(m.anomaly_score, 0)) DESC, m.measured_at DESC
         LIMIT $4`,
        [f.site_id ?? null, f.variable_id ?? null, f.threshold, f.limit]
      )
    ).rows;

    const counts = (
      await query(
        `SELECT count(*) FILTER (WHERE quality_status = 'suspect')::int AS suspect,
                count(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected
         FROM measurements`
      )
    ).rows[0];

    res.json({ items: rows, threshold: f.threshold, counts });
  })
);

export default r;
