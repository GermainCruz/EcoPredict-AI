import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../lib/api';

export function useRequest(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const reload = () => {
    // Un path nulo/ vacío indica "aún no hay parámetros suficientes": no se consulta.
    if (!path) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    api(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload };
}

export function Heading({ title, description, action }) {
  return (
    <div className="flex flex-wrap justify-between items-center gap-3 mb-7">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="muted mt-1 text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Notice({ error, success }) {
  return (
    <>
      {error && <p className="error mb-4">{error}</p>}
      {success && <p className="success mb-4">{success}</p>}
    </>
  );
}

export function Filters({ sites = [], variables = [], site, setSite, variable, setVariable }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <label>Estación de monitoreo</label>
        <select className="form-field" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">Todas las estaciones</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>Variable ambiental</label>
        <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
          <option value="">Todas las variables</option>
          {variables.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.unit})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[tone] || styles.neutral}`}>
      {children}
    </span>
  );
}

export function Modal({ open, title, subtitle, onClose, children, maxWidth = 'max-w-lg' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-xs" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full ${maxWidth} overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100 bg-[#f6faf8]">
          <div>
            <h3 className="text-lg font-bold text-ink">{title}</h3>
            {subtitle && <p className="text-xs muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-200/60"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} maxWidth="max-w-md">
      <div className="flex gap-3 items-start">
        <div className={`p-2.5 rounded-xl shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
          <AlertTriangle size={20} />
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      </div>
      <div className="flex justify-end gap-2.5 mt-6">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2.5 rounded-xl font-semibold text-white text-sm ${
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-leaf hover:opacity-95'
          }`}
        >
          {loading ? 'Procesando...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
