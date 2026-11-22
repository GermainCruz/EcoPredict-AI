import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { parseCookies } from './utils/cookies.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import catalogs from './routes/catalogs.js';
import measurements from './routes/measurements.js';
import dashboard from './routes/dashboard.js';
import predictions from './routes/predictions.js';
import reports from './routes/reports.js';
import audit from './routes/audit.js';
import alerts from './routes/alerts.js';
import profile from './routes/profile.js';
import quality from './routes/quality.js';
import analytics from './routes/analytics.js';
import reference from './routes/reference.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
// Credenciales habilitadas para permitir la cookie httpOnly del refresh token.
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: true }));
// Límite ampliado: la importación CSV/Excel viaja como base64 en el cuerpo JSON.
app.use(express.json({ limit: '12mb' }));
// Parseo de cookies (refresh token httpOnly).
app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'EcoPredict AI API' }));
app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/catalogs', catalogs);
app.use('/api/measurements', measurements);
app.use('/api/dashboard', dashboard);
app.use('/api/predictions', predictions);
app.use('/api/reports', reports);
app.use('/api/audit', audit);
app.use('/api/alerts', alerts);
app.use('/api/profile', profile);
app.use('/api/quality', quality);
app.use('/api/analytics', analytics);
app.use('/api/reference-thresholds', reference);
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  const status =
    err instanceof ZodError ? 422 : err.status || (['23505', '23503', '23514'].includes(err.code) ? 409 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({
    error: err instanceof ZodError ? 'Datos inválidos' : status === 500 ? 'Error interno del servidor' : err.message,
    ...(err instanceof ZodError ? { issues: err.issues } : {}),
  });
});
