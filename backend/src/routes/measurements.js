import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { query, tx } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { wrap, HttpError } from '../utils/errors.js';
import { audit } from '../services/audit.js';
import { detectAnomalies } from '../ai/anomaly.js';
import { evaluateMeasurement } from '../services/alerts.js';
import { dispatchNotifications } from '../services/notifications.js';

const r = Router();
r.use(authenticate);

const schema = z.object({
  site_id: z.coerce.number().int().positive(),
  variable_id: z.coerce.number().int().positive(),
  value: z.coerce.number().finite(),
  measured_at: z.string().datetime({ offset: true }),
  notes: z.string().max(1000).optional(),
  source_type: z.enum(['manual', 'import', 'sensor', 'demo']).default('manual'),
  quality_status: z.enum(['valid', 'suspect', 'rejected']).default('valid'),
});

async function checkRange(variable_id, value) {
  const v = (await query('SELECT min_value,max_value FROM environmental_variables WHERE id=$1', [variable_id])).rows[0];
  if (!v) throw new HttpError(400, 'Variable inexistente');
  if ((v.min_value !== null && value < Number(v.min_value)) || (v.max_value !== null && value > Number(v.max_value)))
    throw new HttpError(422, 'Valor fuera del rango físico configurado');
}

// ---------------------------------------------------------------------------
// Detección de anomalías + evaluación de alertas en la ingesta (P2).
// ---------------------------------------------------------------------------

// Recalcula el puntaje de anomalía (z-score modificado / MAD + IQR) de toda la
// serie de una estación y variable; devuelve las filas con su índice original.
async function scoreSeries(runner, site_id, variable_id) {
  const rows = (
    await runner.query(
      'SELECT id, value::float8 AS value FROM measurements WHERE site_id=$1 AND variable_id=$2 ORDER BY measured_at ASC, id ASC',
      [site_id, variable_id]
    )
  ).rows;
  const { points, summary } = detectAnomalies(rows.map((x) => Number(x.value)));
  for (let i = 0; i < rows.length; i++) {
    await runner.query('UPDATE measurements SET anomaly_score=$2 WHERE id=$1 AND anomaly_score IS DISTINCT FROM $2', [
      rows[i].id,
      points[i].score,
    ]);
  }
  return { rows, points, summary };
}

// Marca como 'suspect' los registros recién ingresados que resultaron anómalos,
// sin sobrescribir decisiones manuales de calidad.
async function flagSuspects(runner, scored, ids) {
  const set = new Set(ids.map(Number));
  const flagged = [];
  scored.rows.forEach((row, i) => {
    if (set.has(Number(row.id)) && scored.points[i].isAnomaly) flagged.push(Number(row.id));
  });
  if (flagged.length)
    await runner.query(
      "UPDATE measurements SET quality_status='suspect' WHERE id = ANY($1::bigint[]) AND quality_status='valid'",
      [flagged]
    );
  return flagged;
}

// scoreSeries + flagSuspects + evaluateMeasurement sobre los registros ingresados.
async function processIngest(runner, site_id, variable_id, insertedRows) {
  const scored = await scoreSeries(runner, site_id, variable_id);
  const flagged = await flagSuspects(runner, scored, insertedRows.map((row) => row.id));
  const alerts = [];
  for (const row of insertedRows) {
    const created = await evaluateMeasurement(runner, { id: row.id, site_id, variable_id, value: row.value });
    alerts.push(...created);
  }
  return { flagged, alerts, summary: scored.summary };
}

// ---------------------------------------------------------------------------
// Importación desde CSV / Excel (P1).
// ---------------------------------------------------------------------------

const HEADER_ALIASES = {
  measured_at: ['measured_at', 'fecha', 'fecha_hora', 'fechahora', 'timestamp', 'date', 'datetime'],
  value: ['value', 'valor', 'medicion', 'medición', 'lectura'],
  notes: ['notes', 'nota', 'notas', 'observacion', 'observación', 'comentario'],
};

function normalizeHeader(h) {
  const k = String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(k)) return key;
  return null;
}

function toIso(cell) {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.toISOString();
  if (cell && typeof cell === 'object' && 'result' in cell) return toIso(cell.result);
  if (cell === null || cell === undefined || cell === '') return null;
  const s = String(cell).trim().replace(' ', 'T');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumber(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (cell && typeof cell === 'object' && 'result' in cell) return toNumber(cell.result);
  if (cell === null || cell === undefined || cell === '') return null;
  const raw = String(cell).trim().replace(/\s/g, '');
  let n = Number(raw);
  if (!Number.isFinite(n) && raw.includes(',')) n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Parser CSV tolerante a comillas y delimitadores (coma o punto y coma).
function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim());
  const delimiter = firstLine && firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((x) => x.some((v) => String(v).trim() !== ''));
}

async function matrixFromExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(422, 'El archivo no contiene hojas de cálculo');
  const matrix = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell) => values.push(cell.value));
    matrix.push(values);
  });
  return matrix;
}

// Convierte una matriz (cabecera opcional + filas) en registros candidatos.
function recordsFromMatrix(matrix) {
  if (!matrix.length) return [];
  const header = matrix[0].map(normalizeHeader);
  const iDate = header.indexOf('measured_at');
  const iValue = header.indexOf('value');
  const iNotes = header.indexOf('notes');
  const hasHeader = iDate >= 0 && iValue >= 0;
  const body = hasHeader ? matrix.slice(1) : matrix;
  const cd = hasHeader ? iDate : 0;
  const cv = hasHeader ? iValue : 1;
  const cn = hasHeader ? iNotes : 2;
  const recs = [];
  body.forEach((row, idx) => {
    const measured_at = toIso(row[cd]);
    const value = toNumber(row[cv]);
    if (measured_at === null && value === null) return;
    const noteCell = cn >= 0 ? row[cn] : undefined;
    recs.push({
      line: idx + (hasHeader ? 2 : 1),
      measured_at,
      value,
      notes: noteCell === undefined || noteCell === null ? null : String(noteCell).slice(0, 1000),
    });
  });
  return recs;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

r.get(
  '/',
  wrap(async (req, res) => {
    const filter = z
      .object({
        site_id: z.coerce.number().int().positive().optional(),
        variable_id: z.coerce.number().int().positive().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const args = [
      filter.site_id ?? null,
      filter.variable_id ?? null,
      filter.from ?? null,
      filter.to ?? null,
      filter.limit,
      filter.offset,
    ];
    const where =
      '($1::bigint IS NULL OR m.site_id=$1) AND ($2::bigint IS NULL OR m.variable_id=$2) AND ($3::timestamptz IS NULL OR m.measured_at >= $3) AND ($4::timestamptz IS NULL OR m.measured_at <= $4)';
    const rows = (
      await query(
        `SELECT m.*,s.name AS site_name,v.name AS variable_name,v.unit FROM measurements m JOIN monitoring_sites s ON s.id=m.site_id JOIN environmental_variables v ON v.id=m.variable_id WHERE ${where} ORDER BY m.measured_at DESC,m.id DESC LIMIT $5 OFFSET $6`,
        args
      )
    ).rows;
    const total = (await query(`SELECT count(*)::integer AS total FROM measurements m WHERE ${where}`, args.slice(0, 4))).rows[0].total;
    res.json({ items: rows, total });
  })
);

// Registro manual: detecta anomalías y evalúa alertas tras insertar.
r.post(
  '/',
  wrap(async (req, res) => {
    const d = schema.parse(req.body);
    await checkRange(d.variable_id, d.value);
    const out = await tx(async (c) => {
      const x = await c.query(
        'INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,notes,source_type,quality_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [d.site_id, d.variable_id, req.user.id, d.value, d.measured_at, d.notes ?? null, d.source_type, d.quality_status]
      );
      const processed = await processIngest(c, d.site_id, d.variable_id, x.rows);
      await c.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)', [
        req.user.id,
        'CREATE_MEASUREMENT',
        'measurements',
        x.rows[0].id,
      ]);
      return { measurement: x.rows[0], ...processed };
    });
    // Notificación de alertas críticas fuera de la transacción (P1 #17).
    const notified = await dispatchNotifications(out.alerts);
    res.status(201).json({
      ...out.measurement,
      anomaly_flagged: out.flagged.includes(Number(out.measurement.id)),
      alerts_created: out.alerts.length,
      notifications_sent: notified.length,
    });
  })
);

// Importación masiva desde CSV/Excel: { site_id, variable_id, filename, content (base64), format? }
r.post(
  '/import',
  wrap(async (req, res) => {
    const d = z
      .object({
        site_id: z.coerce.number().int().positive(),
        variable_id: z.coerce.number().int().positive(),
        filename: z.string().max(255).optional(),
        format: z.enum(['csv', 'xlsx', 'auto']).default('auto'),
        content: z.string().min(1),
        source_type: z.enum(['import', 'sensor', 'demo']).default('import'),
      })
      .parse(req.body);

    let buffer;
    try {
      buffer = Buffer.from(d.content, 'base64');
    } catch {
      throw new HttpError(422, 'Contenido base64 inválido');
    }
    if (!buffer.length) throw new HttpError(422, 'Archivo vacío');

    let format = d.format;
    if (format === 'auto') {
      const name = (d.filename || '').toLowerCase();
      format = name.endsWith('.xlsx') || name.endsWith('.xls') || buffer[0] === 0x50 ? 'xlsx' : 'csv';
    }

    let records;
    try {
      const matrix = format === 'xlsx' ? await matrixFromExcel(buffer) : parseCsv(buffer.toString('utf8'));
      records = recordsFromMatrix(matrix);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, 'No se pudo interpretar el archivo: ' + e.message);
    }
    if (!records.length) throw new HttpError(422, 'El archivo no contiene filas legibles');

    const variable = (await query('SELECT min_value,max_value FROM environmental_variables WHERE id=$1', [d.variable_id])).rows[0];
    if (!variable) throw new HttpError(400, 'Variable inexistente');

    const errors = [];
    const valid = [];
    const seen = new Set();
    for (const rec of records) {
      if (rec.measured_at === null || rec.value === null) {
        errors.push({ line: rec.line, reason: 'Fecha o valor inválido' });
        continue;
      }
      if (
        (variable.min_value !== null && rec.value < Number(variable.min_value)) ||
        (variable.max_value !== null && rec.value > Number(variable.max_value))
      ) {
        errors.push({ line: rec.line, reason: 'Valor fuera del rango físico configurado' });
        continue;
      }
      const key = rec.measured_at;
      if (seen.has(key)) {
        errors.push({ line: rec.line, reason: 'Fecha duplicada dentro del archivo' });
        continue;
      }
      seen.add(key);
      valid.push(rec);
    }

    const out = await tx(async (c) => {
      const inserted = [];
      let duplicates = 0;
      for (const rec of valid) {
        const x = await c.query(
          `INSERT INTO measurements(site_id,variable_id,user_id,value,measured_at,notes,source_type,quality_status)
           VALUES($1,$2,$3,$4,$5,$6,$7,'valid')
           ON CONFLICT (site_id,variable_id,measured_at) DO NOTHING RETURNING *`,
          [d.site_id, d.variable_id, req.user.id, rec.value, rec.measured_at, rec.notes, d.source_type]
        );
        if (x.rows.length) inserted.push(x.rows[0]);
        else duplicates += 1;
      }
      const processed = inserted.length
        ? await processIngest(c, d.site_id, d.variable_id, inserted)
        : { flagged: [], alerts: [], summary: null };
      await c.query('INSERT INTO audit_logs(user_id,action,entity_type,details) VALUES($1,$2,$3,$4)', [
        req.user.id,
        'IMPORT_MEASUREMENTS',
        'measurements',
        JSON.stringify({ format, inserted: inserted.length, duplicates, failed: errors.length, flagged: processed.flagged.length }),
      ]);
      return { inserted: inserted.length, duplicates, ...processed };
    });

    // Notificación de alertas críticas fuera de la transacción (P1 #17).
    const notified = await dispatchNotifications(out.alerts);
    res.status(201).json({
      format,
      received: records.length,
      inserted: out.inserted,
      duplicates: out.duplicates,
      failed: errors.length,
      flagged: out.flagged.length,
      alerts_created: out.alerts.length,
      notifications_sent: notified.length,
      errors: errors.slice(0, 50),
      errors_truncated: errors.length > 50,
      summary: out.summary,
    });
  })
);

r.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = z
      .object({
        value: z.coerce.number().finite().optional(),
        notes: z.string().max(1000).nullable().optional(),
        quality_status: z.enum(['valid', 'suspect', 'rejected']).optional(),
      })
      .strict()
      .parse(req.body);
    const curr = (await query('SELECT * FROM measurements WHERE id=$1', [id])).rows[0];
    if (!curr) throw new HttpError(404, 'Medición inexistente');
    if (req.user.role !== 'admin' && Number(curr.user_id) !== Number(req.user.id))
      throw new HttpError(403, 'Solo puedes editar tus mediciones');
    if (d.value !== undefined) await checkRange(curr.variable_id, d.value);
    const q = await query(
      'UPDATE measurements SET value=COALESCE($2,value),notes=CASE WHEN $3::boolean THEN $4 ELSE notes END,quality_status=COALESCE($5,quality_status),updated_at=now() WHERE id=$1 RETURNING *',
      [id, d.value ?? null, Object.hasOwn(d, 'notes'), d.notes ?? null, d.quality_status ?? null]
    );
    await audit(req.user.id, 'UPDATE_MEASUREMENT', 'measurements', id, d);
    res.json(q.rows[0]);
  })
);

r.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const q = await tx(async (c) => {
      const x = await c.query('DELETE FROM measurements WHERE id=$1 RETURNING id', [id]);
      if (!x.rows.length) throw new HttpError(404, 'Medición inexistente');
      await c.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)', [
        req.user.id,
        'DELETE_MEASUREMENT',
        'measurements',
        id,
      ]);
      return x;
    });
    res.json({ deleted: Number(q.rows[0].id) });
  })
);

export default r;
