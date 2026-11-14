import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Heading, Modal, Notice, useRequest } from '../components/Shared';

const CATEGORY_BADGE = {
  air: { label: 'Aire', tone: 'info' },
  water: { label: 'Agua', tone: 'success' },
  weather: { label: 'Ambiental', tone: 'warning' },
};

export default function Catalogs({ role }) {
  const { data: sites, reload: reloadSites } = useRequest('/catalogs/sites');
  const { data: variables, reload: reloadVars } = useRequest('/catalogs/variables');

  const [siteOpen, setSiteOpen] = useState(false);
  const [varOpen, setVarOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
    </>
  );
}
