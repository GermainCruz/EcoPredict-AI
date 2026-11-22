import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../config/db.js';
import { wrap, HttpError } from '../utils/errors.js';
import { authenticate } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { serializeCookie, clearCookie } from '../utils/cookies.js';

const router = Router();
const REFRESH_COOKIE = 'eco_refresh';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // segundos
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const sign = (sub, typ, expiry) =>
  jwt.sign({ sub: String(sub), typ }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: expiry });
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// El refresh token viaja en cookie httpOnly; nunca en el cuerpo ni en almacenamiento del navegador.
function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  };
}

router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await query(
      'SELECT u.id,u.full_name,u.email,u.status,u.password_hash,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1)',
      [email]
    );
    const u = rows[0];
    if (!u || u.status !== 'active' || !(await bcrypt.compare(password, u.password_hash)))
      throw new HttpError(401, 'Credenciales inválidas');
    const accessToken = sign(u.id, 'access', '20m');
    const refreshToken = sign(u.id, 'refresh', '7d');
    await query("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')", [
      u.id,
      hash(refreshToken),
    ]);
    await audit(u.id, 'LOGIN', 'users', u.id);
    res.setHeader('Set-Cookie', serializeCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions()));
    res.json({ accessToken, user: { id: u.id, full_name: u.full_name, email: u.email, role: u.role } });
  })
);

router.post(
  '/refresh',
  wrap(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    if (!token) throw new HttpError(401, 'Refresh token ausente');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Refresh token inválido');
    }
    if (payload.typ !== 'refresh') throw new HttpError(401, 'Tipo de token inválido');
    const result = await tx(async (c) => {
      const r = await c.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING user_id',
        [hash(token)]
      );
      if (!r.rows.length) throw new HttpError(401, 'Refresh token expirado o reutilizado');
      const u = await c.query("SELECT id FROM users WHERE id=$1 AND status='active'", [r.rows[0].user_id]);
      if (!u.rows.length) throw new HttpError(401, 'Cuenta inactiva');
      const newRefresh = sign(u.rows[0].id, 'refresh', '7d');
      await c.query(
        "INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",
        [u.rows[0].id, hash(newRefresh)]
      );
      return { accessToken: sign(u.rows[0].id, 'access', '20m'), refreshToken: newRefresh };
    });
    res.setHeader('Set-Cookie', serializeCookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions()));
    res.json({ accessToken: result.accessToken });
  })
);

router.post(
  '/logout',
  authenticate,
  wrap(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    if (token)
      await query('UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2', [
        hash(token),
        req.user.id,
      ]);
    await audit(req.user.id, 'LOGOUT');
    res.setHeader('Set-Cookie', clearCookie(REFRESH_COOKIE, refreshCookieOptions()));
    res.json({ ok: true });
  })
);

router.get('/me', authenticate, (req, res) => res.json(req.user));

export default router;
