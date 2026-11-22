import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, permit } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { audit } from '../services/audit.js';
import { applyRuleToHistory } from '../services/alerts.js';
import { dispatchNotifications } from '../services/notifications.js';

const r = Router();
r.use(authenticate);

// Resumen de alertas por estado/severidad (para KPIs del dashboard).
r.get(
  '/summary',
  wrap(async (req, res) => {
    const rows = (
      await query('SELECT status, severity, count(*)::integer AS count FROM alerts GROUP BY status, severity')
    ).rows;
    res.json({ rows });
  })
);

// Listado de reglas de alerta.
r.get(
  '/rules',
  wrap(async (req, res) => {
    const rows = (
      await query(
        `SELECT ar.*, s.name AS site_name, v.name AS variable_name, v.unit
         FROM alert_rules ar
         LEFT JOIN monitoring_sites s ON s.id = ar.site_id
         JOIN environmental_variables v ON v.id = ar.variable_id
         ORDER BY v.name, s.name NULLS FIRST`
      )
    ).rows;
    res.json(rows);
  })
);

// Crear regla (solo admin). Requiere al menos un umbral.
r.post(
  '/rules',
  permit('admin'),
  wrap(async (req, res) => {
    const d = z
      .object({
        site_id: z.coerce.number().int().positive().nullable().optional(),
        variable_id: z.coerce.number().int().positive(),
        min_threshold: z.coerce.number().finite().nullable().optional(),
        max_threshold: z.coerce.number().finite().nullable().optional(),
        severity: z.enum(['info', 'warning', 'critical']).default('warning'),
      })
      .parse(req.body);
    if ((d.min_threshold ?? null) === null && (d.max_threshold ?? null) === null)
      throw new HttpError(422, 'Define al menos un umbral (mínimo o máximo)');
    const q = await query(
      `INSERT INTO alert_rules(site_id,variable_id,min_threshold,max_threshold,severity,created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.site_id ?? null, d.variable_id, d.min_threshold ?? null, d.max_threshold ?? null, d.severity, req.user.id]
    );
    await audit(req.user.id, 'CREATE_ALERT_RULE', 'alert_rules', q.rows[0].id, d);
    // P1 #16: evaluación retroactiva sobre el histórico de la variable/estación.
    const retro = await applyRuleToHistory({ query }, q.rows[0]);
    if (retro.length) await dispatchNotifications(retro);
    res.status(201).json({ ...q.rows[0], retroactive_alerts: retro.length });
  })
);

// Actualizar regla (solo admin). Los campos ausentes no se modifican.
r.patch(
  '/rules/:id',
  permit('admin'),
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = z
      .object({
        site_id: z.coerce.number().int().positive().nullable().optional(),
        min_threshold: z.coerce.number().finite().nullable().optional(),
        max_threshold: z.coerce.number().finite().nullable().optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const q = await query(
      `UPDATE alert_rules SET
         site_id = CASE WHEN $2::boolean THEN $3 ELSE site_id END,
         min_threshold = CASE WHEN $4::boolean THEN $5 ELSE min_threshold END,
         max_threshold = CASE WHEN $6::boolean THEN $7 ELSE max_threshold END,
         severity = COALESCE($8, severity),
         enabled = COALESCE($9, enabled)
       WHERE id=$1 RETURNING *`,
      [
        id,
        Object.hasOwn(d, 'site_id'),
        d.site_id ?? null,
        Object.hasOwn(d, 'min_threshold'),
        d.min_threshold ?? null,
        Object.hasOwn(d, 'max_threshold'),
        d.max_threshold ?? null,
        d.severity ?? null,
        d.enabled ?? null,
      ]
    );
    if (!q.rows.length) throw new HttpError(404, 'Regla inexistente');
    await audit(req.user.id, 'UPDATE_ALERT_RULE', 'alert_rules', id, d);
    // P1 #16: al reactivar o cambiar umbrales, se reevalúa el histórico.
    let retroactive = 0;
    if (q.rows[0].enabled) {
      const retro = await applyRuleToHistory({ query }, q.rows[0]);
      if (retro.length) await dispatchNotifications(retro);
      retroactive = retro.length;
    }
    res.json({ ...q.rows[0], retroactive_alerts: retroactive });
  })
);

// Eliminar regla (solo admin).
r.delete(
  '/rules/:id',
  permit('admin'),
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const q = await query('DELETE FROM alert_rules WHERE id=$1 RETURNING id', [id]);
    if (!q.rows.length) throw new HttpError(404, 'Regla inexistente');
    await audit(req.user.id, 'DELETE_ALERT_RULE', 'alert_rules', id);
    res.json({ deleted: Number(q.rows[0].id) });
  })
);

// P1 #17: registro de notificaciones emitidas por alertas críticas.
r.get(
  '/notifications',
  wrap(async (req, res) => {
    const f = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    const rows = (
      await query(
        `SELECT n.id, n.alert_id, n.channel, n.target, n.status, n.error, n.created_at, n.sent_at,
                a.severity, s.name AS site_name, v.name AS variable_name
         FROM notifications n
         LEFT JOIN alerts a ON a.id = n.alert_id
         LEFT JOIN monitoring_sites s ON s.id = a.site_id
         LEFT JOIN environmental_variables v ON v.id = a.variable_id
         ORDER BY n.created_at DESC
         LIMIT $1`,
        [f.limit]
      )
    ).rows;
    res.json(rows);
  })
);

// Listado de alertas disparadas con filtros y paginación.
r.get(
  '/',
  wrap(async (req, res) => {
    const f = z
      .object({
        status: z.enum(['open', 'acknowledged', 'dismissed', 'all']).default('all'),
        severity: z.enum(['info', 'warning', 'critical', 'all']).default('all'),
        site_id: z.coerce.number().int().positive().optional(),
        variable_id: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const where = `($1 = 'all' OR a.status = $1) AND ($2 = 'all' OR a.severity = $2)
      AND ($3::bigint IS NULL OR a.site_id = $3) AND ($4::bigint IS NULL OR a.variable_id = $4)`;
    const args = [f.status, f.severity, f.site_id ?? null, f.variable_id ?? null];
    const rows = (
      await query(
        `SELECT a.*, s.name AS site_name, v.name AS variable_name, v.unit, u.full_name AS acknowledged_by_name
         FROM alerts a
         JOIN monitoring_sites s ON s.id = a.site_id
         JOIN environmental_variables v ON v.id = a.variable_id
         LEFT JOIN users u ON u.id = a.acknowledged_by
         WHERE ${where}
         ORDER BY a.triggered_at DESC
         LIMIT $5 OFFSET $6`,
        [...args, f.limit, f.offset]
      )
    ).rows;
    const total = (
      await query(`SELECT count(*)::integer AS total FROM alerts a WHERE ${where}`, args)
    ).rows[0].total;
    res.json({ items: rows, total });
  })
);

// Reconocer o descartar una alerta.
r.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = z.object({ status: z.enum(['open', 'acknowledged', 'dismissed']) }).strict().parse(req.body);
    const q = await query(
      `UPDATE alerts SET status=$2,
         acknowledged_at = CASE WHEN $2='acknowledged' THEN now() ELSE acknowledged_at END,
         acknowledged_by = CASE WHEN $2='acknowledged' THEN $3 ELSE acknowledged_by END
       WHERE id=$1 RETURNING *`,
      [id, d.status, req.user.id]
    );
    if (!q.rows.length) throw new HttpError(404, 'Alerta inexistente');
    await audit(req.user.id, 'UPDATE_ALERT', 'alerts', id, d);
    res.json(q.rows[0]);
  })
);

export default r;
