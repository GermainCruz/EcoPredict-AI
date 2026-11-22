import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, permit } from '../middleware/auth.js';
import { wrap } from '../utils/errors.js';

const r = Router();
r.use(authenticate, permit('admin'));

const filterSchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  user_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function buildFilter(req) {
  const f = filterSchema.parse(req.query);
  const where = `($1::timestamptz IS NULL OR a.occurred_at >= $1)
    AND ($2::timestamptz IS NULL OR a.occurred_at <= $2)
    AND ($3::text IS NULL OR a.action ILIKE '%' || $3 || '%')
    AND ($4::bigint IS NULL OR a.user_id = $4)`;
  const args = [f.from ?? null, f.to ?? null, f.action ?? null, f.user_id ?? null];
  return { f, where, args };
}

r.get(
  '/',
  wrap(async (req, res) => {
    const { f, where, args } = buildFilter(req);
    const items = (
      await query(
        `SELECT a.id, a.user_id, u.full_name AS user_name, u.email AS user_email,
                a.action, a.entity_type, a.entity_id, a.details, a.occurred_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT $5 OFFSET $6`,
        [...args, f.limit, f.offset]
      )
    ).rows;
    const total = (await query(`SELECT count(*)::int AS total FROM audit_logs a WHERE ${where}`, args)).rows[0].total;
    res.json({ items, total });
  })
);

// P0 #6: exportación CSV de la auditoría con los mismos filtros.
r.get(
  '/export.csv',
  wrap(async (req, res) => {
    const { where, args } = buildFilter(req);
    const rows = (
      await query(
        `SELECT a.id, a.occurred_at, a.user_id, u.full_name AS user_name, u.email AS user_email,
                a.action, a.entity_type, a.entity_id, a.details
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT 20000`,
        args
      )
    ).rows;

    const headers = ['id', 'ocurrido_en', 'usuario_id', 'usuario', 'email', 'accion', 'entidad', 'entidad_id', 'detalles'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const x of rows) {
      lines.push(
        [x.id, x.occurred_at instanceof Date ? x.occurred_at.toISOString() : x.occurred_at, x.user_id, x.user_name, x.user_email, x.action, x.entity_type, x.entity_id, x.details]
          .map(esc)
          .join(',')
      );
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="auditoria_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  })
);

export default r;
