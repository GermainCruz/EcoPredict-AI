import React, { useState } from 'react';
import { Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, ConfirmDialog, Heading, Modal, Notice, useRequest } from '../components/Shared';

const CATEGORY_BADGE = {
  air: { label: 'Aire', tone: 'info' },
  water: { label: 'Agua', tone: 'success' },
  weather: { label: 'Ambiental', tone: 'warning' },
};

export default function Catalogs({ role }) {
  const { data: sites, reload: reloadSites } = useRequest('/catalogs/sites');
  const { data: variables, reload: reloadVars } = useRequest('/catalogs/variables');
  const { data: refThresholds, reload: reloadRef } = useRequest('/reference-thresholds');

  const [siteOpen, setSiteOpen] = useState(false);
  const [varOpen, setVarOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [deleteRef, setDeleteRef] = useState(null);
  const [saving, setSaving] = useState(false);

  const [refForm, setRefForm] = useState({
    variable_id: '',
    label: '',
    min_value: '',
    max_value: '',
    source: '',
    source_url: '',
    jurisdiction: '',
  });

  const [site, setSite] = useState({ name: '', latitude: '', longitude: '', description: '' });
  const [variable, setVariable] = useState({
    code: '',
    name: '',
    category: 'air',
    unit: '',
    min_value: '',
    max_value: '',
    reference_value: '',
    reference_context: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(type, e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      if (type === 'site') {
        await api('/catalogs/sites', {
          method: 'POST',
          body: {
            ...site,
            latitude: site.latitude === '' ? null : Number(site.latitude),
            longitude: site.longitude === '' ? null : Number(site.longitude),
          },
        });
        reloadSites();
        setSite({ name: '', latitude: '', longitude: '', description: '' });
        setSiteOpen(false);
        setSuccess('Estación agregada al catálogo.');
      } else {
        await api('/catalogs/variables', {
          method: 'POST',
          body: {
            ...variable,
            ...Object.fromEntries(
              ['min_value', 'max_value', 'reference_value'].map((k) => [
                k,
                variable[k] === '' ? null : Number(variable[k]),
              ])
            ),
          },
        });
        reloadVars();
        setVariable({
          code: '',
          name: '',
          category: 'air',
          unit: '',
          min_value: '',
          max_value: '',
          reference_value: '',
          reference_context: '',
        });
        setVarOpen(false);
        setSuccess('Variable ambiental agregada al catálogo.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitRef(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (refForm.min_value === '' && refForm.max_value === '') {
      setError('Define al menos un valor de referencia (mínimo o máximo).');
      return;
    }
    setSaving(true);
    try {
      await api('/reference-thresholds', {
        method: 'POST',
        body: {
          variable_id: Number(refForm.variable_id),
          label: refForm.label,
          min_value: refForm.min_value === '' ? null : Number(refForm.min_value),
          max_value: refForm.max_value === '' ? null : Number(refForm.max_value),
          source: refForm.source,
          source_url: refForm.source_url === '' ? null : refForm.source_url,
          jurisdiction: refForm.jurisdiction === '' ? null : refForm.jurisdiction,
        },
      });
      setSuccess('Umbral de referencia creado (nueva versión activa).');
      setRefForm({ variable_id: '', label: '', min_value: '', max_value: '', source: '', source_url: '', jurisdiction: '' });
      setRefOpen(false);
      reloadRef();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRef(r) {
    setError('');
    setSuccess('');
    try {
      await api('/reference-thresholds/' + r.id, { method: 'PATCH', body: { is_active: !r.is_active } });
      reloadRef();
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDeleteRef() {
    if (!deleteRef) return;
    setError('');
    setSaving(true);
    try {
      await api('/reference-thresholds/' + deleteRef.id, { method: 'DELETE' });
      setSuccess('Umbral de referencia eliminado.');
      setDeleteRef(null);
      reloadRef();
    } catch (err) {
      setError(err.message);
      setDeleteRef(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Estaciones y variables"
        description="Catálogo administrado con unidades, rangos físicos y contexto de referencia."
      />
      <Notice error={error} success={success} />

      <div className="grid xl:grid-cols-2 gap-5">
        <section className="panel">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="h2 mb-0">Estaciones ({sites?.length ?? 0})</h2>
            {role === 'admin' && (
              <button type="button" className="btn text-sm py-2 px-3.5" onClick={() => setSiteOpen(true)}>
                <Plus size={16} /> Nueva estación
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Latitud</th>
                  <th>Longitud</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {sites?.map((x) => (
                  <tr key={x.id}>
                    <td className="font-semibold text-ink">{x.name}</td>
                    <td>{x.latitude ?? '—'}</td>
                    <td>{x.longitude ?? '—'}</td>
                    <td className="max-w-[200px] truncate muted" title={x.description || ''}>
                      {x.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="h2 mb-0">Variables ({variables?.length ?? 0})</h2>
            {role === 'admin' && (
              <button type="button" className="btn text-sm py-2 px-3.5" onClick={() => setVarOpen(true)}>
                <Plus size={16} /> Nueva variable
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Variable</th>
                  <th>Categoría</th>
                  <th>Unidad</th>
                  <th>Rango físico</th>
                </tr>
              </thead>
              <tbody>
                {variables?.map((x) => {
                  const cb = CATEGORY_BADGE[x.category] || { label: x.category, tone: 'neutral' };
                  return (
                    <tr key={x.id}>
                      <td className="font-mono font-bold text-xs">{x.code}</td>
                      <td className="font-semibold text-ink">{x.name}</td>
                      <td>
                        <Badge tone={cb.tone}>{cb.label}</Badge>
                      </td>
                      <td>{x.unit}</td>
                      <td className="muted text-xs">
                        {x.min_value ?? '−∞'} a {x.max_value ?? '+∞'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel mt-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="h2 mb-1">Umbrales de referencia ({refThresholds?.length ?? 0})</h2>
            <p className="muted text-sm">
              Valores normativos u orientativos con fuente citada. Son contexto de referencia, no reglas de
              alerta operativas. Una nueva versión del mismo (variable, etiqueta) desactiva la anterior.
            </p>
          </div>
          {role === 'admin' && (
            <button
              type="button"
              className="btn text-sm py-2 px-3.5"
              onClick={() => {
                setError('');
                setRefOpen(true);
              }}
            >
              <Plus size={16} /> Nuevo umbral
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Etiqueta</th>
                <th>Rango</th>
                <th>Fuente</th>
                <th>Jurisdicción</th>
                <th>Versión</th>
                <th>Estado</th>
                {role === 'admin' && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {refThresholds?.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-ink">
                    {r.variable_name} <span className="muted font-normal">({r.unit})</span>
                  </td>
                  <td>{r.label}</td>
                  <td className="muted text-xs">
                    {r.min_value !== null ? `≥ ${r.min_value}` : ''}
                    {r.min_value !== null && r.max_value !== null ? ' – ' : ''}
                    {r.max_value !== null ? `≤ ${r.max_value}` : ''}
                  </td>
                  <td className="max-w-[240px] truncate muted" title={r.source}>
                    {r.source_url ? (
                      <a className="text-leaf underline" href={r.source_url} target="_blank" rel="noreferrer">
                        {r.source}
                      </a>
                    ) : (
                      r.source
                    )}
                  </td>
                  <td>{r.jurisdiction || '—'}</td>
                  <td>v{r.version}</td>
                  <td>
                    <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  {role === 'admin' && (
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-leaf bg-emerald-50 hover:bg-emerald-100"
                          onClick={() => toggleRef(r)}
                        >
                          <Power size={13} /> {r.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100"
                          onClick={() => setDeleteRef(r)}
                        >
                          <Trash2 size={13} /> Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!refThresholds?.length && <p className="muted p-4">Aún no hay umbrales de referencia registrados.</p>}
        </div>
      </section>

      <Modal
        open={siteOpen}
        title="Agregar estación de monitoreo"
        subtitle="Define el punto geográfico y su descripción."
        onClose={() => setSiteOpen(false)}
        maxWidth="max-w-md"
      >
        <form className="space-y-4" onSubmit={(e) => submit('site', e)}>
          {[
            ['name', 'Nombre', true, 'text'],
            ['latitude', 'Latitud', false, 'number'],
            ['longitude', 'Longitud', false, 'number'],
            ['description', 'Descripción', false, 'text'],
          ].map(([k, l, req, type]) => (
            <div key={k}>
              <label>{l}</label>
              <input
                className="form-field"
                required={req}
                type={type}
                step="any"
                value={site[k]}
                onChange={(e) => setSite({ ...site, [k]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSiteOpen(false)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Agregar estación'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={varOpen}
        title="Agregar variable ambiental"
        subtitle="El código debe usar solo mayúsculas, números o guión bajo (ej. NO2)."
        onClose={() => setVarOpen(false)}
        maxWidth="max-w-lg"
      >
        <form className="grid grid-cols-2 gap-3.5" onSubmit={(e) => submit('variable', e)}>
          {[
            ['code', 'Código', true, 'text'],
            ['name', 'Nombre', true, 'text'],
            ['unit', 'Unidad', true, 'text'],
            ['min_value', 'Mínimo físico', false, 'number'],
            ['max_value', 'Máximo físico', false, 'number'],
            ['reference_value', 'Referencia opcional', false, 'number'],
            ['reference_context', 'Contexto normativo', false, 'text'],
          ].map(([k, l, req, type]) => (
            <div key={k} className={k === 'reference_context' ? 'col-span-2' : ''}>
              <label>{l}</label>
              <input
                className="form-field"
                required={req}
                type={type}
                step="any"
                value={variable[k]}
                onChange={(e) => setVariable({ ...variable, [k]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label>Categoría</label>
            <select
              className="form-field"
              value={variable.category}
              onChange={(e) => setVariable({ ...variable, category: e.target.value })}
            >
              <option value="air">Aire</option>
              <option value="water">Agua</option>
              <option value="weather">Ambiental</option>
            </select>
          </div>
          <div className="col-span-2 flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setVarOpen(false)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Agregar variable'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={refOpen}
        title="Nuevo umbral de referencia"
        subtitle="Documenta el valor normativo con su fuente citada. Se guarda como una nueva versión activa."
        onClose={() => setRefOpen(false)}
        maxWidth="max-w-lg"
      >
        <form className="grid sm:grid-cols-2 gap-4" onSubmit={submitRef}>
          <div className="sm:col-span-2">
            <label>Variable</label>
            <select
              required
              className="form-field"
              value={refForm.variable_id}
              onChange={(e) => setRefForm((f) => ({ ...f, variable_id: e.target.value }))}
            >
              <option value="">Seleccionar</option>
              {variables?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label>Etiqueta</label>
            <input
              required
              className="form-field"
              placeholder="Ej. Directriz OMS - media 24h"
              value={refForm.label}
              onChange={(e) => setRefForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div>
            <label>Valor mínimo</label>
            <input
              type="number"
              step="any"
              className="form-field"
              value={refForm.min_value}
              onChange={(e) => setRefForm((f) => ({ ...f, min_value: e.target.value }))}
              placeholder="Sin mínimo"
            />
          </div>
          <div>
            <label>Valor máximo</label>
            <input
              type="number"
              step="any"
              className="form-field"
              value={refForm.max_value}
              onChange={(e) => setRefForm((f) => ({ ...f, max_value: e.target.value }))}
              placeholder="Sin máximo"
            />
          </div>
          <div className="sm:col-span-2">
            <label>Fuente</label>
            <input
              required
              className="form-field"
              placeholder="Ej. OMS 2021 (Global air quality guidelines)"
              value={refForm.source}
              onChange={(e) => setRefForm((f) => ({ ...f, source: e.target.value }))}
            />
          </div>
          <div>
            <label>URL de la fuente (opcional)</label>
            <input
              type="url"
              className="form-field"
              placeholder="https://…"
              value={refForm.source_url}
              onChange={(e) => setRefForm((f) => ({ ...f, source_url: e.target.value }))}
            />
          </div>
          <div>
            <label>Jurisdicción (opcional)</label>
            <input
              className="form-field"
              placeholder="Ej. Internacional"
              value={refForm.jurisdiction}
              onChange={(e) => setRefForm((f) => ({ ...f, jurisdiction: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2.5 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setRefOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Crear umbral'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRef)}
        title="Eliminar umbral de referencia"
        message={
          deleteRef
            ? `¿Eliminar el umbral "${deleteRef.label}" de ${deleteRef.variable_name}? Esta acción quedará registrada en auditoría.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        danger
        loading={saving}
        onConfirm={confirmDeleteRef}
        onCancel={() => setDeleteRef(null)}
      />
    </>
  );
}
