import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(authenticate);

// Datos de la propia cuenta.
r.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.status, r.name AS role, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  })
);

// Cambio de contraseña propio: exige la contraseña actual.
r.put(
  '/password',
  wrap(async (req, res) => {
    const d = z
      .object({
        current_password: z.string().min(1),
        new_password: z.string().min(10).max(128),
      })
      .parse(req.body);
    if (d.current_password === d.new_password)
      throw new HttpError(422, 'La nueva contraseña debe ser distinta de la actual');

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) throw new HttpError(404, 'Usuario inexistente');
    if (!(await bcrypt.compare(d.current_password, rows[0].password_hash)))
      throw new HttpError(401, 'Contraseña actual incorrecta');

    const hash = await bcrypt.hash(d.new_password, 12);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hash]);
    // Se revocan todas las sesiones de refresco para forzar reautenticación.
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      req.user.id,
    ]);
    await audit(req.user.id, 'CHANGE_PASSWORD', 'users', req.user.id);
    res.json({ ok: true });
  })
);

export default r;
