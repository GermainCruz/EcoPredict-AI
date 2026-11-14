import React, { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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

export default function Measurements({ role }) {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [saving, setSaving] = useState(false);

  const query = new URLSearchParams(
    Object.entries({ site_id: site, variable_id: variable, limit: 100 }).filter(([, v]) => v)
  );
  const { data, reload } = useRequest('/measurements?' + query.toString());

  const [form, setForm] = useState({
    site_id: '',
    variable_id: '',
    value: '',
    measured_at: now(),
    source_type: 'manual',
    notes: '',
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submitCreate(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/measurements', {
        method: 'POST',
        body: {
          ...form,
          site_id: Number(form.site_id),
          variable_id: Number(form.variable_id),
          value: Number(form.value),
          measured_at: new Date(form.measured_at).toISOString(),
        },
      });
      setSuccess('Medición registrada correctamente.');
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
        description="Registro, consulta, validación y seguimiento por ubicación y variable."
        action={
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
        }
      />
      <Notice error={error} success={success} />

      <section className="panel">
        <h2 className="h2">Historial ({data?.total ?? 0})</h2>
        <Filters
          sites={sites || []}
          variables={variables || []}
          site={site}
          setSite={setSite}
          variable={variable}
          setVariable={setVariable}
        />
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
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((x) => {
                const qb = QUALITY_BADGE[x.quality_status] || {
                  label: x.quality_status,
                  tone: 'neutral',
                };
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
          {!data?.items?.length && (
            <p className="muted p-4">No hay mediciones para estos filtros.</p>
          )}
        </div>
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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar medición'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editItem)}
        title="Editar medición"
        subtitle={
          editItem ? `${editItem.site_name} — ${editItem.variable_name} (${editItem.unit})` : ''
        }
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
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditItem(null)}
                disabled={saving}
              >
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
