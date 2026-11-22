import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';
import Plot, { baseLayout, downloadFigure } from '../components/Plot';

const TABS = [
  ['trend', 'Tendencia y control'],
  ['comparison', 'Comparación'],
  ['distribution', 'Distribuciones'],
  ['temporal', 'Patrón temporal'],
];

const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 'N/D' : Number(v).toFixed(d));
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function Analytics() {
  const [tab, setTab] = useState('trend');
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');

  return (
    <>
      <Heading
        title="Analítica ambiental"
        description="Tendencias, control estadístico, comparación entre estaciones y patrones temporales."
      />
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${
              tab === key
                ? 'bg-leaf text-white border-leaf'
                : 'bg-white text-slate-600 border-slate-200 hover:border-leaf/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'trend' && <TrendTab sites={sites} variables={variables} />}
      {tab === 'comparison' && <ComparisonTab sites={sites} variables={variables} />}
      {tab === 'distribution' && <DistributionTab variables={variables} />}
      {tab === 'temporal' && <TemporalTab sites={sites} variables={variables} />}
    </>
  );
}

function TrendTab({ sites, variables }) {
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const ready = site && variable;
  const { data, error } = useRequest(ready ? `/analytics/trend?site_id=${site}&variable_id=${variable}` : null);

  const spc = data?.spc;
  const trend = data?.trend;

  const traces = useMemo(() => {
    if (!data?.series?.length) return [];
    return [
      {
        x: data.series.map((x) => new Date(x.date).toISOString().slice(0, 10)),
        y: data.series.map((x) => x.value),
        customdata: data.series.map((x) => x.samples),
        type: 'scatter',
        mode: 'lines+markers',
        name: `${data.variable?.name} (${data.variable?.unit})`,
        line: { color: '#087968', width: 2 },
        marker: { size: 4, color: '#2f9e8f' },
        hovertemplate: '%{x}<br>Valor: %{y:.3f}<br>Muestras: %{customdata}<extra></extra>',
      },
    ];
  }, [data]);

  const layout = useMemo(() => {
    const shapes = [];
    const addLine = (y, color, dash) => {
      if (y === null || y === undefined || !Number.isFinite(Number(y))) return;
      shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color, width: 1.3, dash } });
    };
    if (spc) {
      addLine(spc.center, '#3b7dd8', 'dot');
      addLine(spc.ucl, '#d9534f', 'dash');
      addLine(spc.lcl, '#d9534f', 'dash');
      addLine(spc.robustUcl, '#f0a63a', 'dot');
      addLine(spc.robustLcl, '#f0a63a', 'dot');
    }
    for (const r of data?.reference || []) {
      addLine(r.min_value, '#7c3aed', 'dashdot');
      addLine(r.max_value, '#7c3aed', 'dashdot');
    }
    return baseLayout({ xaxis: { gridcolor: '#e4eee9', type: 'date' }, shapes });
  }, [spc, data]);

  return (
    <>
      <section className="panel">
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label>Estación</label>
            <select className="form-field" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Seleccionar</option>
              {sites?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Variable</label>
            <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
              <option value="">Seleccionar</option>
              {variables?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.unit})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {ready && (
        <section className="panel mt-5">
          <Notice error={error} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="h2 mb-1">Serie diaria con límites de control</h2>
              <p className="muted text-sm">
                Límites de Shewhart ±3σ (rojo) y robustos por MAD (ámbar); centro (azul). Las líneas
                violetas corresponden a umbrales de referencia normativos activos.
              </p>
            </div>
            {traces.length > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() =>
                  downloadFigure(document.querySelector('#trend-chart .js-plotly-plot'), 'ecopredict_tendencia_spc')
                }
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            )}
          </div>

          {traces.length ? (
            <>
              <div id="trend-chart" className="mt-4">
                <Plot style={{ height: 380 }} data={traces} layout={layout} />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
                <Metric label="Centro (media)" value={fmt(spc?.center)} />
                <Metric label="UCL / LCL (±3σ)" value={`${fmt(spc?.ucl)} / ${fmt(spc?.lcl)}`} />
                <Metric label="Pendiente de Sen" value={fmt(trend?.senSlope, 4)} />
                <Metric
                  label="Tendencia (Mann-Kendall)"
                  value={
                    trend ? (
                      <Badge tone={trend.significant ? (trend.direction === 'up' ? 'danger' : 'success') : 'neutral'}>
                        {trend.direction === 'up' ? 'Ascendente' : trend.direction === 'down' ? 'Descendente' : 'Estable'}
                        {trend.significant ? ' · sig.' : ' · n/s'}
                      </Badge>
                    ) : (
                      'N/D'
                    )
                  }
                />
              </div>
              {trend && (
                <p className="muted text-sm mt-3">
                  n = {trend.n} · S = {trend.s} · Z = {fmt(trend.z, 2)} · p = {fmt(trend.pValue, 4)} · τ ={' '}
                  {fmt(trend.tau, 3)}. {trend.significant ? 'Tendencia estadísticamente significativa (α = 0.05).' : 'Sin evidencia suficiente de tendencia.'}
                </p>
              )}
              {data?.reference?.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-bold text-ink mb-2">Umbrales de referencia activos</h3>
                  <ul className="space-y-1.5 text-sm">
                    {data.reference.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 text-slate-700">
                        <Badge tone="neutral">
                          {r.min_value !== null ? `≥ ${r.min_value}` : ''}
                          {r.min_value !== null && r.max_value !== null ? ' – ' : ''}
                          {r.max_value !== null ? `≤ ${r.max_value}` : ''}
                        </Badge>
                        <span className="font-semibold">{r.label}</span>
                        <span className="muted text-xs">
                          {r.source}
                          {r.source_url ? (
                            <>
                              {' · '}
                              <a className="text-leaf underline" href={r.source_url} target="_blank" rel="noreferrer">
                                fuente
                              </a>
                            </>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="muted mt-4">Selecciona una estación y variable con datos válidos.</p>
          )}
        </section>
      )}
    </>
  );
}

function ComparisonTab({ sites, variables }) {
  const [mode, setMode] = useState('sites');
  const [variable, setVariable] = useState('');
  const [site, setSite] = useState('');
  const [siteSel, setSiteSel] = useState([]);
  const [varSel, setVarSel] = useState([]);

  const toggle = (arr, setArr, id) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const path =
    mode === 'sites' && variable && siteSel.length
      ? `/analytics/comparison?variable_id=${variable}&site_ids=${siteSel.join(',')}`
      : mode === 'variables' && site && varSel.length
      ? `/analytics/comparison?site_id=${site}&variable_ids=${varSel.join(',')}`
      : null;
  const { data, error } = useRequest(path);

  const traces = useMemo(() => {
    if (!data?.series?.length) return [];
    const palette = ['#087968', '#2f9e8f', '#f0a63a', '#d9534f', '#3b7dd8', '#7c3aed', '#67c3b4'];
    return data.series.map((s, i) => ({
      x: s.points.map((p) => new Date(p.date).toISOString().slice(0, 10)),
      y: s.points.map((p) => p.value),
      type: 'scatter',
      mode: 'lines',
      name: s.label,
      line: { color: palette[i % palette.length], width: 2 },
      hovertemplate: `${s.label}<br>%{x}<br>%{y:.3f} ${s.unit}<extra></extra>`,
    }));
  }, [data]);

  return (
    <section className="panel">
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          ['sites', 'Una variable entre estaciones'],
          ['variables', 'Varias variables en una estación'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              mode === key ? 'bg-leaf text-white border-leaf' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <label>{mode === 'sites' ? 'Variable a comparar' : 'Estación'}</label>
          {mode === 'sites' ? (
            <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
              <option value="">Seleccionar</option>
              {variables?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.unit})
                </option>
              ))}
            </select>
          ) : (
            <select className="form-field" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Seleccionar</option>
              {sites?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label>{mode === 'sites' ? 'Estaciones a incluir' : 'Variables a incluir'}</label>
          <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 p-2 space-y-1">
            {(mode === 'sites' ? sites : variables)?.map((x) => {
              const sel = mode === 'sites' ? siteSel.includes(String(x.id)) : varSel.includes(String(x.id));
              return (
                <label key={x.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() =>
                      mode === 'sites'
                        ? toggle(siteSel, setSiteSel, String(x.id))
                        : toggle(varSel, setVarSel, String(x.id))
                    }
                  />
                  <span>{x.name}</span>
                  {x.unit && <span className="muted text-xs">({x.unit})</span>}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <Notice error={error} />

      {traces.length ? (
        <>
          <div className="mt-5">
            <Plot style={{ height: 380 }} data={traces} layout={baseLayout({ xaxis: { gridcolor: '#e4eee9', type: 'date' } })} />
          </div>
          <div className="table-wrap mt-5">
            <table>
              <thead>
                <tr>
                  <th>Serie</th>
                  <th>Observaciones</th>
                  <th>Media</th>
                  <th>Desv. estándar</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.key}>
                    <td className="font-semibold text-ink">{s.label}</td>
                    <td>{s.stats?.n ?? 0}</td>
                    <td>{fmt(s.stats?.mean)}</td>
                    <td>{fmt(s.stats?.sd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted mt-4">Selecciona la configuración de comparación para graficar.</p>
      )}
    </section>
  );
}

function DistributionTab({ variables }) {
  const [variable, setVariable] = useState('');
  const { data, error } = useRequest(variable ? `/analytics/distributions?variable_id=${variable}` : null);

  const traces = useMemo(() => {
    if (!data?.groups?.length) return [];
    return [
      {
        type: 'box',
        name: data.variable?.name,
        x: data.groups.map((g) => g.label),
        q1: data.groups.map((g) => g.q1),
        median: data.groups.map((g) => g.median),
        q3: data.groups.map((g) => g.q3),
        lowerfence: data.groups.map((g) => g.min),
        upperfence: data.groups.map((g) => g.max),
        boxpoints: false,
        marker: { color: '#2f9e8f' },
        line: { color: '#087968' },
      },
    ];
  }, [data]);

  return (
    <section className="panel">
      <div className="max-w-md">
        <label>Variable</label>
        <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
          <option value="">Seleccionar</option>
          {variables?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.unit})
            </option>
          ))}
        </select>
      </div>
      <Notice error={error} />
      {traces.length ? (
        <>
          <h2 className="h2 mt-5">
            Distribución de {data.variable?.name} por estación <span className="muted text-sm">({data.variable?.unit})</span>
          </h2>
          <Plot
            style={{ height: 380 }}
            data={traces}
            layout={baseLayout({ hovermode: 'closest', yaxis: { title: data.variable?.unit, gridcolor: '#e4eee9' } })}
          />
          <div className="table-wrap mt-4">
            <table>
              <thead>
                <tr>
                  <th>Estación</th>
                  <th>n</th>
                  <th>Mín</th>
                  <th>Q1</th>
                  <th>Mediana</th>
                  <th>Q3</th>
                  <th>Máx</th>
                  <th>Media</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.label}>
                    <td className="font-semibold text-ink">{g.label}</td>
                    <td>{g.n}</td>
                    <td>{fmt(g.min)}</td>
                    <td>{fmt(g.q1)}</td>
                    <td>{fmt(g.median)}</td>
                    <td>{fmt(g.q3)}</td>
                    <td>{fmt(g.max)}</td>
                    <td>{fmt(g.mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted mt-4">Selecciona una variable para ver su distribución por estación.</p>
      )}
    </section>
  );
}

function TemporalTab({ sites, variables }) {
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const ready = site && variable;
  const { data, error } = useRequest(
    ready ? `/analytics/temporal-heatmap?site_id=${site}&variable_id=${variable}` : null
  );

  const heat = useMemo(() => {
    if (!data?.cells?.length) return null;
    const z = Array.from({ length: 7 }, () => Array(24).fill(null));
    const custom = Array.from({ length: 7 }, () => Array(24).fill(null));
    for (const c of data.cells) {
      z[c.dow][c.hour] = c.value;
      custom[c.dow][c.hour] = [`${DOW[c.dow]} ${String(c.hour).padStart(2, '0')}:00`, `Valor: ${c.value}`, `Muestras: ${c.n}`];
    }
    return {
      z,
      custom,
      x: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`),
      y: DOW,
    };
  }, [data]);

  const trace = useMemo(() => {
    if (!heat) return [];
    return [
      {
        type: 'heatmap',
        x: heat.x,
        y: heat.y,
        z: heat.z,
        customdata: heat.custom,
        colorscale: 'Viridis',
        hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>%{customdata[2]}<extra></extra>',
        colorbar: { thickness: 12 },
      },
    ];
  }, [heat]);

  return (
    <section className="panel">
      <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
        <div>
          <label>Estación</label>
          <select className="form-field" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Seleccionar</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Variable</label>
          <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
            <option value="">Seleccionar</option>
            {variables?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.unit})
              </option>
            ))}
          </select>
        </div>
      </div>
      <Notice error={error} />
      {trace.length ? (
        <>
          <h2 className="h2 mt-5">Patrón por día de la semana y hora</h2>
          <p className="muted text-sm mb-3">Valor promedio histórico en cada combinación día × hora.</p>
          <Plot style={{ height: 360 }} data={trace} layout={baseLayout({ hovermode: 'closest', margin: { l: 60, r: 20, t: 20, b: 60 } })} />
        </>
      ) : (
        <p className="muted mt-4">Selecciona estación y variable para ver el patrón temporal.</p>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-mist rounded-xl p-3">
      <div className="muted text-xs">{label}</div>
      <div className="font-bold text-lg mt-1">{value}</div>
    </div>
  );
}
