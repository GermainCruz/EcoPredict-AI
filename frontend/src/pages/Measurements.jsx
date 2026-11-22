import React, { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  ConfirmDialog,
  Filters,
  Heading,
  Modal,
  Notice,
  useRequest,
} from '../components/Shared';

const now = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const QUALITY_BADGE = {
  valid: { label: 'Válido', tone: 'success' },
  suspect: { label: 'Sospechoso', tone: 'warning' },
  rejected: { label: 'Rechazado', tone: 'danger' },
};

const SOURCE_LABEL = {
  manual: 'Manual',
  demo: 'Demo',
  import: 'Importado',
  sensor: 'Sensor',
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function Measurements({ role }) {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [saving, setSaving] = useState(false);

  const query = new URLSearchParams(
    Object.entries({
      site_id: site,
      variable_id: variable,
      limit,
      offset: page * limit,
    }).filter(([, v]) => v !== '' && v !== 0)
  );
  const { data, reload } = useRequest('/measurements?' + query.toString());

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const [form, setForm] = useState({
    site_id: '',
    variable_id: '',
    value: '',
    measured_at: now(),
    source_type: 'manual',
    notes: '',
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const [importForm, setImportForm] = useState({
    site_id: '',
    variable_id: '',
    source_type: 'import',
    file: null,
  });
  const [importResult, setImportResult] = useState(null);

  async function submitCreate(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const created = await api('/measurements', {
        method: 'POST',
        body: {
          ...form,
          site_id: Number(form.site_id),
          variable_id: Number(form.variable_id),
          value: Number(form.value),
          measured_at: new Date(form.measured_at).toISOString(),
        },
      });
      setSuccess(
        created.anomaly_flagged
          ? 'Medición registrada. Se detectó como valor atípico y se marcó como sospechosa.'
          : 'Medición registrada correctamente.'
      );
      setForm({
        site_id: '',
        variable_id: '',
        value: '',
        measured_at: now(),
        source_type: 'manual',
        notes: '',
      });
      setCreateOpen(false);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitImport(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setImportResult(null);
    if (!importForm.file) {
      setError('Selecciona un archivo CSV o Excel.');
      return;
    }
    setSaving(true);
    try {
      const content = await fileToBase64(importForm.file);
      const r = await api('/measurements/import', {
        method: 'POST',
        body: {
          site_id: Number(importForm.site_id),
          variable_id: Number(importForm.variable_id),
          source_type: importForm.source_type,
          filename: importForm.file.name,
          format: 'auto',
          content,
        },
      });
      setImportResult(r);
      setSuccess(`Importación finalizada: ${r.inserted} registros cargados, ${r.duplicates} duplicados omitidos.`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editItem) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/measurements/' + editItem.id, {
        method: 'PATCH',
        body: {
          value: Number(editItem.value),
          quality_status: editItem.quality_status,
          notes: editItem.notes || null,
        },
      });
      setSuccess('Medición actualizada correctamente.');
      setEditItem(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/measurements/' + deleteItem.id, { method: 'DELETE' });
      setSuccess('Medición eliminada permanentemente.');
      setDeleteItem(null);
      reload();
    } catch (err) {
      setError(err.message);
      setDeleteItem(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Gestión de mediciones"
        description="Registro, importación, consulta, validación y detección de valores atípicos."
        action={
          <div className="flex gap-2.5">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setError('');
                setImportResult(null);
                setImportOpen(true);
              }}
            >
              <Upload size={17} /> Importar CSV/Excel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError('');
                setCreateOpen(true);
              }}
            >
              <Plus size={17} /> Nueva medición
            </button>
          </div>
        }
      />
      <Notice error={error} success={success} />

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2 mb-0">Historial ({total})</h2>
          <div className="flex items-center gap-2 text-sm">
            <label className="mb-0">Filas por página</label>
            <select
              className="form-field py-1.5"
              style={{ width: 90 }}
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(0);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <Filters
            sites={sites || []}
            variables={variables || []}
            site={site}
            setSite={(v) => {
              setSite(v);
              setPage(0);
            }}
            variable={variable}
            setVariable={(v) => {
              setVariable(v);
              setPage(0);
            }}
          />
        </div>
        <div className="table-wrap mt-5">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estación</th>
                <th>Variable</th>
                <th>Valor</th>
                <th>Procedencia</th>
                <th>Calidad</th>
                <th>Atipicidad</th>
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((x) => {
                const qb = QUALITY_BADGE[x.quality_status] || { label: x.quality_status, tone: 'neutral' };
                const score = x.anomaly_score === null || x.anomaly_score === undefined ? null : Number(x.anomaly_score);
                const isOutlier = score !== null && Math.abs(score) > 3.5;
                return (
                  <tr key={x.id}>
                    <td>{new Date(x.measured_at).toLocaleString('es-PE')}</td>
                    <td className="font-medium text-ink">{x.site_name}</td>
                    <td>{x.variable_name}</td>
                    <td className="font-bold">
                      {x.value} <span className="muted font-normal">{x.unit}</span>
                    </td>
                    <td>
                      <Badge tone="info">{SOURCE_LABEL[x.source_type] || x.source_type}</Badge>
                    </td>
                    <td>
                      <Badge tone={qb.tone}>{qb.label}</Badge>
                    </td>
                    <td>
                      {score === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            isOutlier ? 'text-amber-700' : 'text-slate-500'
                          }`}
                        >
                          {isOutlier && <AlertTriangle size={13} />}
                          {score.toFixed(2)}σ
                        </span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate muted" title={x.notes || ''}>
                      {x.notes || '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-leaf bg-emerald-50 hover:bg-emerald-100"
                          onClick={() =>
                            setEditItem({
                              id: x.id,
                              site_name: x.site_name,
                              variable_name: x.variable_name,
                              unit: x.unit,
                              value: x.value,
                              quality_status: x.quality_status,
                              notes: x.notes || '',
                            })
                          }
                        >
                          <Pencil size={13} /> Editar
                        </button>
                        {role === 'admin' && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100"
                            onClick={() => setDeleteItem(x)}
                          >
                            <Trash2 size={13} /> Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data?.items?.length && <p className="muted p-4">No hay mediciones para estos filtros.</p>}
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

      <Modal
        open={createOpen}
        title="Registrar nueva medición"
        subtitle="Ingresa los datos de campo o demostración para una estación y variable."
        onClose={() => setCreateOpen(false)}
        maxWidth="max-w-xl"
      >
        <form className="grid sm:grid-cols-2 gap-4" onSubmit={submitCreate}>
          <div>
            <label>Estación</label>
            <select
              required
              className="form-field"
              value={form.site_id}
              onChange={(e) => update('site_id', e.target.value)}
            >
              <option value="">Seleccionar</option>
              {sites?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Variable</label>
            <select
              required
              className="form-field"
              value={form.variable_id}
              onChange={(e) => update('variable_id', e.target.value)}
            >
              <option value="">Seleccionar</option>
              {variables?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.unit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Valor</label>
            <input
              className="form-field"
              required
              type="number"
              step="any"
              value={form.value}
              onChange={(e) => update('value', e.target.value)}
            />
          </div>
          <div>
            <label>Fecha y hora de medición</label>
            <input
              className="form-field"
              type="datetime-local"
              required
              value={form.measured_at}
              onChange={(e) => update('measured_at', e.target.value)}
            />
          </div>
          <div>
            <label>Procedencia</label>
            <select
              className="form-field"
              value={form.source_type}
              onChange={(e) => update('source_type', e.target.value)}
            >
              <option value="manual">Registro manual</option>
              <option value="demo">Datos demostrativos</option>
              <option value="import">Importación verificada</option>
              <option value="sensor">Sensor verificado</option>
            </select>
          </div>
          <div>
            <label>Notas</label>
            <input
              className="form-field"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Observaciones opcionales"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2.5 mt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar medición'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        title="Importar mediciones desde CSV o Excel"
        subtitle="El archivo debe incluir columnas de fecha y valor (encabezados: fecha/measured_at y valor/value)."
        onClose={() => setImportOpen(false)}
        maxWidth="max-w-xl"
      >
        <form className="space-y-4" onSubmit={submitImport}>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label>Estación destino</label>
              <select
                required
                className="form-field"
                value={importForm.site_id}
                onChange={(e) => setImportForm((f) => ({ ...f, site_id: e.target.value }))}
              >
                <option value="">Seleccionar</option>
                {sites?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Variable destino</label>
              <select
                required
                className="form-field"
                value={importForm.variable_id}
                onChange={(e) => setImportForm((f) => ({ ...f, variable_id: e.target.value }))}
              >
                <option value="">Seleccionar</option>
                {variables?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.unit})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label>Procedencia</label>
              <select
                className="form-field"
                value={importForm.source_type}
                onChange={(e) => setImportForm((f) => ({ ...f, source_type: e.target.value }))}
              >
                <option value="import">Importación verificada</option>
                <option value="sensor">Sensor verificado</option>
                <option value="demo">Datos demostrativos</option>
              </select>
            </div>
            <div>
              <label>Archivo (.csv, .xlsx)</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="form-field"
                onChange={(e) => setImportForm((f) => ({ ...f, file: e.target.files?.[0] || null }))}
              />
            </div>
          </div>
          <p className="muted text-sm">
            Formato esperado: una fila por medición con <code>fecha</code> (ISO o fecha/hora) y{' '}
            <code>valor</code>. Se omiten duplicados y se descartan valores fuera del rango físico.
          </p>

          {importResult && (
            <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">Cargados: {importResult.inserted}</Badge>
                <Badge tone="neutral">Duplicados: {importResult.duplicates}</Badge>
                <Badge tone="warning">Rechazados: {importResult.failed}</Badge>
                {importResult.flagged > 0 && <Badge tone="danger">Atípicos: {importResult.flagged}</Badge>}
                {importResult.alerts_created > 0 && (
                  <Badge tone="danger">Alertas: {importResult.alerts_created}</Badge>
                )}
              </div>
              {importResult.errors?.length > 0 && (
                <ul className="mt-2 max-h-32 overflow-auto text-xs muted">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>
                      Línea {e.line}: {e.reason}
                    </li>
                  ))}
                  {importResult.errors_truncated && <li>… y más filas con error.</li>}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)} disabled={saving}>
              Cerrar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Importando...' : 'Importar archivo'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editItem)}
        title="Editar medición"
        subtitle={editItem ? `${editItem.site_name} — ${editItem.variable_name} (${editItem.unit})` : ''}
        onClose={() => setEditItem(null)}
        maxWidth="max-w-md"
      >
        {editItem && (
          <form className="space-y-4" onSubmit={submitEdit}>
            <div>
              <label>Valor ({editItem.unit})</label>
              <input
                className="form-field"
                type="number"
                step="any"
                required
                value={editItem.value}
                onChange={(e) => setEditItem({ ...editItem, value: e.target.value })}
              />
            </div>
            <div>
              <label>Estado de calidad</label>
              <select
                className="form-field"
                value={editItem.quality_status}
                onChange={(e) => setEditItem({ ...editItem, quality_status: e.target.value })}
              >
                <option value="valid">Válido</option>
                <option value="suspect">Sospechoso</option>
                <option value="rejected">Rechazado</option>
              </select>
            </div>
            <div>
              <label>Notas</label>
              <textarea
                rows={2}
                className="form-field"
                value={editItem.notes}
                onChange={(e) => setEditItem({ ...editItem, notes: e.target.value })}
                placeholder="Motivo de ajuste u observaciones"
              />
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditItem(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn" disabled={saving}>
                {saving ? 'Actualizando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteItem)}
        title="Eliminar medición"
        message={
          deleteItem
            ? `¿Estás seguro de eliminar permanentemente la medición de ${deleteItem.variable_name} (${deleteItem.value} ${deleteItem.unit}) en ${deleteItem.site_name}? Esta acción quedará registrada en auditoría.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        danger
        loading={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteItem(null)}
      />
    </>
  );
}
