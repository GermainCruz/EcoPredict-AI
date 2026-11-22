import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap } from '../utils/errors.js';

const r = Router();
r.use(authenticate);

r.get(
  '/summary',
  wrap(async (req, res) => {
    const stats = (
      await query(
        `SELECT count(*)::integer total,
                count(DISTINCT site_id)::integer sites,
                count(DISTINCT variable_id)::integer variables,
                count(*) FILTER(WHERE quality_status='valid')::integer valid,
                count(*) FILTER(WHERE quality_status='suspect')::integer suspect,
                count(*) FILTER(WHERE quality_status='rejected')::integer rejected
         FROM measurements`
      )
    ).rows[0];
    const byVariable = (
      await query(
        "SELECT v.id,v.name,v.unit,v.category,count(m.id)::integer samples,round(avg(m.value),3) average,round(min(m.value),3) minimum,round(max(m.value),3) maximum FROM environmental_variables v LEFT JOIN measurements m ON m.variable_id=v.id AND m.quality_status='valid' GROUP BY v.id ORDER BY v.category,v.name"
      )
    ).rows;
    const latest = (
      await query(
        'SELECT m.id,m.value,m.measured_at,s.name site,v.name variable,v.unit FROM measurements m JOIN monitoring_sites s ON s.id=m.site_id JOIN environmental_variables v ON v.id=m.variable_id ORDER BY m.measured_at DESC LIMIT 10'
      )
    ).rows;
    const availability = (
      await query(
        `SELECT m.site_id, m.variable_id, s.name AS site_name, v.name AS variable_name, v.unit, v.code AS variable_code,
                count(*)::integer AS valid_count,
                count(DISTINCT a.id) FILTER (WHERE a.status = 'open')::integer AS open_alerts,
                -- Severidad máxima por orden semántico (corrige max() textual que devolvía 'warning').
                CASE
                  WHEN bool_or(a.severity = 'critical') FILTER (WHERE a.status = 'open') THEN 'critical'
                  WHEN bool_or(a.severity = 'warning') FILTER (WHERE a.status = 'open') THEN 'warning'
                  WHEN bool_or(a.severity = 'info') FILTER (WHERE a.status = 'open') THEN 'info'
                END AS top_severity
         FROM measurements m
         JOIN monitoring_sites s ON s.id = m.site_id
         JOIN environmental_variables v ON v.id = m.variable_id
         LEFT JOIN alerts a ON a.site_id = m.site_id AND a.variable_id = m.variable_id AND a.status = 'open'
         WHERE m.quality_status = 'valid'
         GROUP BY m.site_id, m.variable_id, s.name, v.name, v.unit, v.code
         ORDER BY open_alerts DESC NULLS LAST, valid_count DESC, s.name, v.name`
      )
    ).rows;
    // P2: KPIs de alertas para el panel principal.
    const alerts = (
      await query(
        "SELECT count(*)::integer total,count(*) FILTER(WHERE status='open')::integer open,count(*) FILTER(WHERE status='open' AND severity='critical')::integer critical,count(*) FILTER(WHERE status='open' AND severity='warning')::integer warning FROM alerts"
      )
    ).rows[0];
    res.json({ stats, byVariable, latest, availability, alerts });
  })
);

// P2: matriz estación x variable para el mapa de calor del dashboard.
r.get(
  '/heatmap',
  wrap(async (req, res) => {
    const sites = (await query('SELECT id,name,latitude,longitude FROM monitoring_sites ORDER BY name')).rows;
    const variables = (
      await query('SELECT id,code,name,unit,category FROM environmental_variables ORDER BY category,name')
    ).rows;
    const cells = (
      await query(
        `SELECT m.site_id, m.variable_id, round(avg(m.value),4)::float8 AS average,
                round(min(m.value),4)::float8 AS minimum, round(max(m.value),4)::float8 AS maximum,
                count(*)::integer AS samples
         FROM measurements m
         WHERE m.quality_status='valid'
         GROUP BY m.site_id, m.variable_id`
      )
    ).rows;
    res.json({ sites, variables, cells });
  })
);

r.get(
  '/timeseries',
  wrap(async (req, res) => {
    const site = Number(req.query.site_id);
    const variable = Number(req.query.variable_id);
    if (!Number.isInteger(site) || site <= 0 || !Number.isInteger(variable) || variable <= 0) {
      return res.status(400).json({ error: 'site_id y variable_id requeridos' });
    }
    const rows = (
      await query(
        "SELECT date_trunc('day',measured_at) AS date,round(avg(value),4) AS value,count(*)::integer AS samples FROM measurements WHERE site_id=$1 AND variable_id=$2 AND quality_status='valid' GROUP BY 1 ORDER BY 1 DESC LIMIT 180",
        [site, variable]
      )
    ).rows.reverse();
    res.json(rows);
  })
);

export default r;
