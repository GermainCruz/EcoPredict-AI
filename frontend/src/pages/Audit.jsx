import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';

const ACTION_META = {
  LOGIN: { label: 'Inicio de sesión', tone: 'success' },
  LOGOUT: { label: 'Cierre de sesión', tone: 'neutral' },
  CREATE_SITE: { label: 'Creación de estación', tone: 'success' },
  CREATE_VARIABLE: { label: 'Creación de variable', tone: 'success' },
  CREATE_MEASUREMENT: { label: 'Registro de medición', tone: 'success' },
  UPDATE_MEASUREMENT: { label: 'Edición de medición', tone: 'info' },
  DELETE_MEASUREMENT: { label: 'Eliminación de medición', tone: 'danger' },
  RUN_PREDICTION: { label: 'Ejecución de predicción IA', tone: 'info' },
  CREATE_USER: { label: 'Creación de usuario', tone: 'success' },
  UPDATE_USER: { label: 'Actualización de usuario', tone: 'warning' },
  CHANGE_PASSWORD: { label: 'Cambio de contraseña', tone: 'warning' },
  CREATE_ALERT_RULE: { label: 'Creación de regla de alerta', tone: 'success' },
  UPDATE_ALERT_RULE: { label: 'Actualización de regla de alerta', tone: 'warning' },
  DELETE_ALERT_RULE: { label: 'Eliminación de regla de alerta', tone: 'danger' },
  UPDATE_ALERT: { label: 'Actualización de alerta', tone: 'info' },
  CREATE_REFERENCE_THRESHOLD: { label: 'Creación de umbral de referencia', tone: 'success' },
  UPDATE_REFERENCE_THRESHOLD: { label: 'Actualización de umbral de referencia', tone: 'warning' },
  DELETE_REFERENCE_THRESHOLD: { label: 'Eliminación de umbral de referencia', tone: 'danger' },
};

const ENTITY_LABELS = {
  users: 'Usuarios',
  monitoring_sites: 'Estaciones',
  environmental_variables: 'Variables ambientales',
  measurements: 'Mediciones',
  prediction_runs: 'Predicciones IA',
  alert_rules: 'Reglas de alerta',
  alerts: 'Alertas',
  reference_thresholds: 'Umbrales de referencia',
};

export default function Audit() {
  const { data: users } = useRequest('/users');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;
  const [error, setError] = useState('');

  const params = Object.entries({
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to).toISOString() : '',
    action,
    user_id: userId,
    limit,
    offset: page * limit,
  }).filter(([, v]) => v !== '' && v !== 0);

  const { data, error: loadError } = useRequest('/audit?' + new URLSearchParams(params).toString());

  const items = data?.items || [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  async function exportCsv() {
    setError('');
    const q = new URLSearchParams(params.filter(([k]) => k !== 'limit' && k !== 'offset')).toString();
    try {
      const blob = await api(`/audit/export.csv?${q}`, { download: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Heading
        title="Bitácora de auditoría"
        description="Registro trazable de acciones sobre usuarios, mediciones, predicciones y sesiones."
        action={
          <button type="button" className="btn" onClick={exportCsv}>
            <Download size={17} /> Exportar CSV
          </button>
        }
      />
      <Notice error={error || loadError} />

      <section className="panel">
        <h2 className="h2">Filtros</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label>Desde</label>
            <input
              type="datetime-local"
              className="form-field"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <label>Hasta</label>
            <input
              type="datetime-local"
              className="form-field"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <label>Acción (contiene)</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="form-field pl-9"
                placeholder="Ej. MEASUREMENT"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          <div>
            <label>Usuario</label>
            <select
              className="form-field"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="panel table-wrap mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="h2 mb-0">Registros ({total})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => {
              const a = ACTION_META[x.action] || { label: x.action, tone: 'neutral' };
              const entity = x.entity_type ? ENTITY_LABELS[x.entity_type] || x.entity_type : '—';
              return (
                <tr key={x.id}>
                  <td>{new Date(x.occurred_at).toLocaleString('es-PE')}</td>
                  <td>
                    <div className="font-semibold text-ink">{x.user_name || 'Sistema'}</div>
                    {x.user_email && <div className="text-xs muted">{x.user_email}</div>}
                  </td>
                  <td>
                    <Badge tone={a.tone}>{a.label}</Badge>
                  </td>
                  <td>{entity}</td>
                  <td className="muted">{x.entity_id ? `#${x.entity_id}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.length && <p className="muted p-4">No hay entradas de auditoría para estos filtros.</p>}
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
                <ChevronLeft size={14} /> Anterior
              </button>
              <button
                type="button"
                className="btn-secondary py-1.5 px-3 text-xs"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
