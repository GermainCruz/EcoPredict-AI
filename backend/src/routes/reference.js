import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../config/db.js';
import { authenticate, permit } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(authenticate);

const baseSchema = z.object({
  variable_id: z.coerce.number().int().positive(),
  label: z.string().trim().min(3).max(160),
  min_value: z.coerce.number().finite().nullable().optional(),
  max_value: z.coerce.number().finite().nullable().optional(),
  source: z.string().trim().min(3).max(240),
  source_url: z.string().url().max(400).nullable().optional().or(z.literal('')),
  jurisdiction: z.string().trim().max(120).nullable().optional(),
  valid_from: z.string().date().nullable().optional().or(z.literal('')),
  valid_to: z.string().date().nullable().optional().or(z.literal('')),
});

// Listado de umbrales de referencia (contexto normativo, versionado).
r.get(
  '/',
  wrap(async (req, res) => {
    const f = z
      .object({
        variable_id: z.coerce.number().int().positive().optional(),
        active_only: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
      })
      .parse(req.query);
    const rows = (
      await query(
        `SELECT rt.*, rt.min_value::float8 AS min_value, rt.max_value::float8 AS max_value,
                v.code AS variable_code, v.name AS variable_name, v.unit,
                u.full_name AS created_by_name
         FROM reference_thresholds rt
         JOIN environmental_variables v ON v.id = rt.variable_id
         LEFT JOIN users u ON u.id = rt.created_by
         WHERE ($1::bigint IS NULL OR rt.variable_id = $1)
           AND ($2::boolean IS FALSE OR rt.is_active = true)
         ORDER BY v.category, v.name, rt.label, rt.version DESC`,
        [f.variable_id ?? null, f.active_only]
      )
    ).rows;
    res.json(rows);
  })
);

// Crea una nueva versión: desactiva la anterior del mismo (variable, etiqueta).
r.post(
  '/',
  permit('admin'),
  wrap(async (req, res) => {
    const d = baseSchema.parse(req.body);
    if ((d.min_value ?? null) === null && (d.max_value ?? null) === null)
      throw new HttpError(422, 'Define al menos un valor de referencia (mínimo o máximo)');
    const row = await tx(async (c) => {
      await c.query('UPDATE reference_thresholds SET is_active = false WHERE variable_id = $1 AND label = $2 AND is_active = true', [
        d.variable_id,
        d.label,
      ]);
      const q = await c.query(
        `INSERT INTO reference_thresholds
           (variable_id, label, min_value, max_value, source, source_url, jurisdiction, valid_from, valid_to, version, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 (SELECT COALESCE(MAX(version), 0) + 1 FROM reference_thresholds WHERE variable_id = $1 AND label = $2),
                 true, $10)
         RETURNING *`,
        [
          d.variable_id,
          d.label,
          d.min_value ?? null,
          d.max_value ?? null,
          d.source,
          d.source_url || null,
          d.jurisdiction || null,
          d.valid_from || null,
          d.valid_to || null,
          req.user.id,
        ]
      );
      return q.rows[0];
    });
    await audit(req.user.id, 'CREATE_REFERENCE_THRESHOLD', 'reference_thresholds', row.id, { label: d.label });
    res.status(201).json(row);
  })
);

// Actualiza metadatos (no altera el valor, que requiere nueva versión) o el estado activo.
r.patch(
  '/:id',
  permit('admin'),
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = z
      .object({
        source: z.string().trim().min(3).max(240).optional(),
        source_url: z.string().url().max(400).nullable().optional().or(z.literal('')),
        jurisdiction: z.string().trim().max(120).nullable().optional(),
        is_active: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const q = await query(
      `UPDATE reference_thresholds SET
         source = COALESCE($2, source),
         source_url = CASE WHEN $3::boolean THEN $4 ELSE source_url END,
         jurisdiction = CASE WHEN $5::boolean THEN $6 ELSE jurisdiction END,
         is_active = COALESCE($7, is_active)
       WHERE id = $1 RETURNING *`,
      [
        id,
        d.source ?? null,
        Object.hasOwn(d, 'source_url'),
        d.source_url || null,
        Object.hasOwn(d, 'jurisdiction'),
        d.jurisdiction || null,
        d.is_active ?? null,
      ]
    );
    if (!q.rows.length) throw new HttpError(404, 'Umbral inexistente');
    await audit(req.user.id, 'UPDATE_REFERENCE_THRESHOLD', 'reference_thresholds', id, d);
    res.json(q.rows[0]);
  })
);

r.delete(
  '/:id',
  permit('admin'),
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const q = await query('DELETE FROM reference_thresholds WHERE id = $1 RETURNING id', [id]);
    if (!q.rows.length) throw new HttpError(404, 'Umbral inexistente');
    await audit(req.user.id, 'DELETE_REFERENCE_THRESHOLD', 'reference_thresholds', id);
    res.json({ deleted: Number(q.rows[0].id) });
  })
);

export default r;
