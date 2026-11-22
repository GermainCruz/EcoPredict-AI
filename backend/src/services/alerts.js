// Evaluación de reglas de alerta (P2). Se ejecuta tras registrar mediciones
// (individual o importación) y genera alertas cuando el valor cruza un umbral configurado.
// `runner` es cualquier objeto con .query (pool o cliente de transacción).

// Mensaje de cruce de umbral para un valor dado, o null si está dentro de rango.
export function ruleMessage(rule, value) {
  const min = rule.min_threshold === null ? null : Number(rule.min_threshold);
  const max = rule.max_threshold === null ? null : Number(rule.max_threshold);
  if (min !== null && value < min) return `Valor ${value} por debajo del mínimo configurado (${min})`;
  if (max !== null && value > max) return `Valor ${value} por encima del máximo configurado (${max})`;
  return null;
}

export async function evaluateMeasurement(runner, measurement) {
  const { id, site_id, variable_id } = measurement;
  const value = Number(measurement.value);
  if (!Number.isFinite(value)) return [];

  const rules = (
    await runner.query(
      `SELECT * FROM alert_rules
       WHERE enabled = true AND variable_id = $1 AND (site_id IS NULL OR site_id = $2)`,
      [variable_id, site_id]
    )
  ).rows;

  const created = [];
  for (const rule of rules) {
    const message = ruleMessage(rule, value);
    if (!message) continue;

    const inserted = await runner.query(
      `INSERT INTO alerts(rule_id, measurement_id, site_id, variable_id, value, severity, message)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [rule.id, id, site_id, variable_id, value, rule.severity, message]
    );
    created.push(inserted.rows[0]);
  }
  return created;
}

// P1 #16: aplica una regla al histórico de mediciones (evaluación retroactiva).
// Se ejecuta al crear una regla o al reactivarla; evita duplicados por (regla, medición).
export async function applyRuleToHistory(runner, rule, { limit = 1000 } = {}) {
  const rows = (
    await runner.query(
      `SELECT id, site_id, variable_id, value::float8 AS value, measured_at
       FROM measurements
       WHERE variable_id = $1 AND ($2::bigint IS NULL OR site_id = $2)
       ORDER BY measured_at DESC, id DESC
       LIMIT $3`,
      [rule.variable_id, rule.site_id ?? null, limit]
    )
  ).rows;

  const created = [];
  for (const m of rows.reverse()) {
    const value = Number(m.value);
    const message = ruleMessage(rule, value);
    if (!message) continue;
    const inserted = await runner.query(
      `INSERT INTO alerts(rule_id, measurement_id, site_id, variable_id, value, severity, message, triggered_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE rule_id=$1 AND measurement_id=$2)
       RETURNING *`,
      [rule.id, m.id, m.site_id, m.variable_id, value, rule.severity, message, m.measured_at]
    );
    if (inserted.rows.length) created.push(inserted.rows[0]);
  }
  return created;
}
