import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, permit } from '../middleware/auth.js';
import { wrap } from '../utils/errors.js';

const r = Router();
r.use(authenticate, permit('admin'));

r.get(
  '/',
  wrap(async (req, res) => {
    const rows = (
      await query(
        `SELECT a.id, a.user_id, u.full_name AS user_name, u.email AS user_email,
                a.action, a.entity_type, a.entity_id, a.details, a.occurred_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.occurred_at DESC
         LIMIT 200`
      )
    ).rows;
    res.json(rows);
  })
);

export default r;
