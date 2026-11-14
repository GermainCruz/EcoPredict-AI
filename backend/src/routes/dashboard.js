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
        "SELECT count(*)::integer total,count(DISTINCT site_id)::integer sites,count(DISTINCT variable_id)::integer variables,count(*) FILTER(WHERE quality_status='suspect')::integer suspect FROM measurements"
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
        "SELECT m.site_id,m.variable_id,s.name AS site_name,v.name AS variable_name,v.unit,count(*)::integer AS valid_count FROM measurements m JOIN monitoring_sites s ON s.id=m.site_id JOIN environmental_variables v ON v.id=m.variable_id WHERE m.quality_status='valid' GROUP BY m.site_id,m.variable_id,s.name,v.name,v.unit ORDER BY valid_count DESC,s.name,v.name"
      )
    ).rows;
    res.json({ stats, byVariable, latest, availability });
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
