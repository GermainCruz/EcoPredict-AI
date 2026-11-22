import React, { useState } from 'react';
import { BellOff, CheckCircle2, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, ConfirmDialog, Heading, Modal, Notice, useRequest } from '../components/Shared';

const SEVERITY = {
  info: { label: 'Informativa', tone: 'info' },
  warning: { label: 'Advertencia', tone: 'warning' },
  critical: { label: 'Crítica', tone: 'danger' },
};

const STATUS = {
  open: { label: 'Abierta', tone: 'danger' },
  acknowledged: { label: 'Reconocida', tone: 'success' },
  dismissed: { label: 'Descartada', tone: 'neutral' },
};

const CHANNEL = {
  webhook: { label: 'Webhook', tone: 'info' },
  email: { label: 'Correo', tone: 'success' },
  log: { label: 'Registro', tone: 'neutral' },
};

const DELIVERY = {
  sent: { label: 'Enviada', tone: 'success' },
  pending: { label: 'Pendiente', tone: 'warning' },
  failed: { label: 'Fallida', tone: 'danger' },
};

export default function Alerts({ role }) {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const { data: summary, reload: reloadSummary } = useRequest('/alerts/summary');
  const { data: rules, reload: reloadRules } = useRequest('/alerts/rules');
  const { data: notifications, reload: reloadNotifications } = useRequest('/alerts/notifications');

  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('all');
  const [page, setPage] = useState(0);
  const limit = 25;
  const query = new URLSearchParams(
    Object.entries({ status, severity, limit, offset: page * limit }).filter(([, v]) => v !== '' && v !== 0)
  );
  const { data, reload } = useRequest('/alerts?' + query.toString());

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [deleteRule, setDeleteRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    site_id: '',
    variable_id: '',
    min_threshold: '',
    max_threshold: '',
    severity: 'warning',
  });

  const counts = (summary?.rows || []).reduce(
    (acc, r) => {
      acc.total += r.count;
      if (r.status === 'open') acc.open += r.count;
      if (r.status === 'open' && r.severity === 'critical') acc.critical += r.count;
      return acc;
    },
    { total: 0, open: 0, critical: 0 }
  );

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  async function setAlertStatus(id, next) {
    setError('');
    setSuccess('');
    try {
      await api('/alerts/' + id, { method: 'PATCH', body: { status: next } });
      setSuccess(next === 'acknowledged' ? 'Alerta reconocida.' : 'Alerta descartada.');
      reload();
      reloadSummary();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitRule(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (ruleForm.min_threshold === '' && ruleForm.max_threshold === '') {
      setError('Define al menos un umbral (mínimo o máximo).');
      return;
    }
    setSaving(true);
    try {
      const created = await api('/alerts/rules', {
        method: 'POST',
        body: {
          site_id: ruleForm.site_id === '' ? null : Number(ruleForm.site_id),
          variable_id: Number(ruleForm.variable_id),
          min_threshold: ruleForm.min_threshold === '' ? null : Number(ruleForm.min_threshold),
          max_threshold: ruleForm.max_threshold === '' ? null : Number(ruleForm.max_threshold),
          severity: ruleForm.severity,
        },
      });
      setSuccess(
        created?.retroactive_alerts > 0
          ? `Regla de alerta creada. Se generaron ${created.retroactive_alerts} alertas retroactivas sobre el histórico.`
          : 'Regla de alerta creada.'
      );
      setRuleForm({ site_id: '', variable_id: '', min_threshold: '', max_threshold: '', severity: 'warning' });
      setRuleOpen(false);
      reloadRules();
      reloadSummary();
      reloadNotifications();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule) {
    setError('');
    try {
      const updated = await api('/alerts/rules/' + rule.id, { method: 'PATCH', body: { enabled: !rule.enabled } });
      reloadRules();
      reloadSummary();
      reloadNotifications();
      if (updated?.retroactive_alerts > 0) {
        setSuccess(`Se generaron ${updated.retroactive_alerts} alertas retroactivas al reactivar la regla.`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDeleteRule() {
    if (!deleteRule) return;
    setError('');
    setSaving(true);
    try {
      await api('/alerts/rules/' + deleteRule.id, { method: 'DELETE' });
      setSuccess('Regla eliminada.');
      setDeleteRule(null);
      reloadRules();
    } catch (err) {
      setError(err.message);
      setDeleteRule(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Alertas y umbrales"
        description="Monitoreo de umbrales configurables por estación y variable, con reconocimiento y descarte."
        action={
          role === 'admin' && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError('');
                setRuleOpen(true);
              }}
            >
              <Plus size={17} /> Nueva regla
            </button>
          )
        }
      />
      <Notice error={error} success={success} />

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          ['Alertas abiertas', counts.open],
          ['Críticas abiertas', counts.critical],
          ['Alertas históricas', counts.total],
        ].map(([k, v], i) => (
          <div className="panel" key={k}>
            <div className="muted text-sm">{k}</div>
            <div className={`text-3xl font-bold mt-3 ${i < 2 && v > 0 ? 'text-red-600' : ''}`}>{v}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2 mb-0">Alertas disparadas ({total})</h2>
          <div className="flex flex-wrap gap-4">
            <div>
              <label>Estado</label>
              <select
                className="form-field py-1.5"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="open">Abiertas</option>
                <option value="acknowledged">Reconocidas</option>
                <option value="dismissed">Descartadas</option>
                <option value="all">Todas</option>
              </select>
            </div>
            <div>
              <label>Severidad</label>
              <select
                className="form-field py-1.5"
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Todas</option>
                <option value="info">Informativa</option>
                <option value="warning">Advertencia</option>
                <option value="critical">Crítica</option>
              </select>
            </div>
          </div>
        </div>

        <div className="table-wrap mt-5">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estación</th>
                <th>Variable</th>
                <th>Valor</th>
                <th>Severidad</th>
                <th>Estado</th>
                <th>Mensaje</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((a) => {
                const sv = SEVERITY[a.severity] || { label: a.severity, tone: 'neutral' };
                const st = STATUS[a.status] || { label: a.status, tone: 'neutral' };
                return (
                  <tr key={a.id}>
                    <td>{new Date(a.triggered_at).toLocaleString('es-PE')}</td>
                    <td className="font-medium text-ink">{a.site_name}</td>
                    <td>{a.variable_name}</td>
                    <td className="font-bold">
                      {a.value} <span className="muted font-normal">{a.unit}</span>
                    </td>
                    <td>
                      <Badge tone={sv.tone}>{sv.label}</Badge>
                    </td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="max-w-[260px] truncate muted" title={a.message}>
                      {a.message}
                    </td>
                    <td>
                      {a.status === 'open' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-leaf bg-emerald-50 hover:bg-emerald-100"
                            onClick={() => setAlertStatus(a.id, 'acknowledged')}
                          >
                            <CheckCircle2 size={13} /> Reconocer
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                            onClick={() => setAlertStatus(a.id, 'dismissed')}
                          >
                            <BellOff size={13} /> Descartar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data?.items?.length && <p className="muted p-4">No hay alertas para estos filtros.</p>}
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="muted">
              Página {page + 1} de {pageCount}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5 px-3 text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn-secondary py-1.5 px-3 text-xs"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel mt-5">
        <h2 className="h2">Reglas de umbral ({rules?.length ?? 0})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Estación</th>
                <th>Mínimo</th>
                <th>Máximo</th>
                <th>Severidad</th>
                <th>Estado</th>
                {role === 'admin' && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rules?.map((r) => {
                const sv = SEVERITY[r.severity] || { label: r.severity, tone: 'neutral' };
                return (
                  <tr key={r.id}>
                    <td className="font-semibold text-ink">
                      {r.variable_name} <span className="muted font-normal">({r.unit})</span>
                    </td>
                    <td>{r.site_name || 'Todas las estaciones'}</td>
                    <td>{r.min_threshold ?? '—'}</td>
                    <td>{r.max_threshold ?? '—'}</td>
                    <td>
                      <Badge tone={sv.tone}>{sv.label}</Badge>
                    </td>
                    <td>
                      <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Activa' : 'Inactiva'}</Badge>
                    </td>
                    {role === 'admin' && (
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-leaf bg-emerald-50 hover:bg-emerald-100"
                            onClick={() => toggleRule(r)}
                          >
                            <Power size={13} /> {r.enabled ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100"
                            onClick={() => setDeleteRule(r)}
                          >
                            <Trash2 size={13} /> Eliminar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rules?.length && (
            <p className="muted p-4">
              Aún no hay reglas configuradas. Las alertas se generan cuando una medición cruza los umbrales definidos.
            </p>
          )}
        </div>
      </section>

      <section className="panel mt-5">
        <h2 className="h2">Notificaciones emitidas ({notifications?.length ?? 0})</h2>
        <p className="muted text-sm mb-4">
          Registro de envíos disparados por alertas. Los canales se configuran en el servidor; el canal «Registro» solo
          deja constancia sin salir del sistema.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Alerta</th>
                <th>Canal</th>
                <th>Destino</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {notifications?.map((n) => {
                const ch = CHANNEL[n.channel] || { label: n.channel, tone: 'neutral' };
                const dl = DELIVERY[n.status] || { label: n.status, tone: 'neutral' };
                const sv = SEVERITY[n.severity] || null;
                return (
                  <tr key={n.id}>
                    <td>{new Date(n.sent_at || n.created_at).toLocaleString('es-PE')}</td>
                    <td>
                      <span className="font-medium text-ink">{n.site_name || '—'}</span>
                      <span className="muted"> · {n.variable_name || '—'}</span>
                      {sv && (
                        <span className="ml-2">
                          <Badge tone={sv.tone}>{sv.label}</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={ch.tone}>{ch.label}</Badge>
                    </td>
                    <td className="muted max-w-[220px] truncate" title={n.target}>
                      {n.target || '—'}
                    </td>
                    <td>
                      <Badge tone={dl.tone}>{dl.label}</Badge>
                    </td>
                    <td className="muted max-w-[240px] truncate" title={n.error || ''}>
                      {n.error || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!notifications?.length && (
            <p className="muted p-4">
              No se han registrado notificaciones. Se emiten automáticamente cuando una alerta crítica se dispara.
            </p>
          )}
        </div>
      </section>

      <Modal
        open={ruleOpen}
        title="Nueva regla de alerta"
        subtitle="Define umbrales mínimo y/o máximo para una variable (opcionalmente de una estación específica)."
        onClose={() => setRuleOpen(false)}
        maxWidth="max-w-lg"
      >
        <form className="grid sm:grid-cols-2 gap-4" onSubmit={submitRule}>
          <div>
            <label>Variable</label>
            <select
              required
              className="form-field"
              value={ruleForm.variable_id}
              onChange={(e) => setRuleForm((f) => ({ ...f, variable_id: e.target.value }))}
            >
              <option value="">Seleccionar</option>
              {variables?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.unit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Estación (opcional)</label>
            <select
              className="form-field"
              value={ruleForm.site_id}
              onChange={(e) => setRuleForm((f) => ({ ...f, site_id: e.target.value }))}
            >
              <option value="">Todas las estaciones</option>
              {sites?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Umbral mínimo</label>
            <input
              className="form-field"
              type="number"
              step="any"
              value={ruleForm.min_threshold}
              onChange={(e) => setRuleForm((f) => ({ ...f, min_threshold: e.target.value }))}
              placeholder="Sin mínimo"
            />
          </div>
          <div>
            <label>Umbral máximo</label>
            <input
              className="form-field"
              type="number"
              step="any"
              value={ruleForm.max_threshold}
              onChange={(e) => setRuleForm((f) => ({ ...f, max_threshold: e.target.value }))}
              placeholder="Sin máximo"
            />
          </div>
          <div>
            <label>Severidad</label>
            <select
              className="form-field"
              value={ruleForm.severity}
              onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
            >
              <option value="info">Informativa</option>
              <option value="warning">Advertencia</option>
              <option value="critical">Crítica</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2.5 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setRuleOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Crear regla'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRule)}
        title="Eliminar regla de alerta"
        message={
          deleteRule
            ? `¿Eliminar la regla de ${deleteRule.variable_name} en ${deleteRule.site_name || 'todas las estaciones'}? Las alertas ya generadas se conservan.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        danger
        loading={saving}
        onConfirm={confirmDeleteRule}
        onCancel={() => setDeleteRule(null)}
      />
    </>
  );
}
