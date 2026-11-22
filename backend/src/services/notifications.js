// Notificaciones de alertas críticas (P1 #17).
// Debe invocarse DESPUÉS del commit de la transacción que creó las alertas para
// no mantener una conexión de base de datos abierta durante una llamada de red.
// Si no hay ALERT_WEBHOOK_URL configurada, la notificación se registra como
// 'skipped' (queda trazabilidad sin depender de un servicio externo).
import { query } from '../config/db.js';

async function contextFor(alert) {
  const { rows } = await query(
    `SELECT s.name AS site_name, v.name AS variable_name, v.unit
     FROM monitoring_sites s, environmental_variables v
     WHERE s.id = $1 AND v.id = $2`,
    [alert.site_id, alert.variable_id]
  );
  return rows[0] || {};
}

export async function dispatchNotifications(alerts = []) {
  const critical = alerts.filter((a) => a && a.severity === 'critical');
  if (!critical.length) return [];

  const url = process.env.ALERT_WEBHOOK_URL;
  const results = [];

  for (const alert of critical) {
    const meta = await contextFor(alert);
    const payload = {
      alert_id: alert.id,
      severity: alert.severity,
      value: Number(alert.value),
      message: alert.message,
      site: meta.site_name || null,
      variable: meta.variable_name || null,
      unit: meta.unit || null,
      triggered_at: alert.triggered_at || new Date().toISOString(),
    };

    if (!url) {
      const ins = await query(
        `INSERT INTO notifications(alert_id,channel,status,payload,sent_at)
         VALUES($1,'log','skipped',$2,now()) RETURNING *`,
        [alert.id, JSON.stringify(payload)]
      );
      results.push(ins.rows[0]);
      continue;
    }

    const ins = await query(
      `INSERT INTO notifications(alert_id,channel,target,status,payload)
       VALUES($1,'webhook',$2,'queued',$3) RETURNING *`,
      [alert.id, url, JSON.stringify(payload)]
    );
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const upd = await query(
        `UPDATE notifications SET status=$2, sent_at=now(), error=$3 WHERE id=$1 RETURNING *`,
        [ins.rows[0].id, resp.ok ? 'sent' : 'failed', resp.ok ? null : `HTTP ${resp.status}`]
      );
      results.push(upd.rows[0]);
    } catch (e) {
      const upd = await query(`UPDATE notifications SET status='failed', error=$2 WHERE id=$1 RETURNING *`, [
        ins.rows[0].id,
        String(e.message).slice(0, 300),
      ]);
      results.push(upd.rows[0]);
    }
  }
  return results;
}
