import React, { useMemo, useState } from 'react';
import { Heading, Notice, useRequest } from '../components/Shared';

const W = 1000;
const H = 620;
const PAD = 60;

const lerp = (a, b, t) => a + (b - a) * t;
function colorFor(t) {
  const clamp = Math.max(0, Math.min(1, t));
  const from = [47, 158, 143]; // verde
  const mid = [240, 166, 58]; // ámbar
  const to = [217, 83, 79]; // rojo
  const lerpRgb = (c1, c2, u) => c1.map((v, i) => Math.round(lerp(v, c2[i], u)));
  const rgb = clamp < 0.5 ? lerpRgb(from, mid, clamp * 2) : lerpRgb(mid, to, (clamp - 0.5) * 2);
  return `rgb(${rgb.join(',')})`;
}

export default function MapPage() {
  const { data: sites, error } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const { data: heatmap } = useRequest('/dashboard/heatmap');
  const { data: refThresholds } = useRequest('/reference-thresholds?active_only=true');
  const [variable, setVariable] = useState('all');
  const [mode, setMode] = useState('observed');
  const [hover, setHover] = useState(null);

  const geo = (sites || []).filter((s) => s.latitude !== null && s.longitude !== null);

  const projection = useMemo(() => {
    const lats = geo.map((s) => Number(s.latitude));
    const lons = geo.map((s) => Number(s.longitude));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const spanLat = maxLat - minLat || 0.01;
    const spanLon = maxLon - minLon || 0.01;
    const px = (lon) => PAD + ((Number(lon) - minLon) / spanLon) * (W - 2 * PAD);
    const py = (lat) => H - PAD - ((Number(lat) - minLat) / spanLat) * (H - 2 * PAD);
    return { px, py, minLat, maxLat, minLon, maxLon };
  }, [geo]);

  const activeVar = variables?.find((v) => String(v.id) === String(variable)) || null;

  // Valores por sitio para la variable elegida (o total de muestras si "all").
  const values = useMemo(() => {
    const cells = heatmap?.cells || [];
    const out = {};
    for (const s of geo) {
      const siteCells = cells.filter((c) => Number(c.site_id) === Number(s.id));
      if (variable === 'all') {
        const samples = siteCells.reduce((a, c) => a + Number(c.samples), 0);
        out[s.id] = { value: samples, samples, metric: 'muestras' };
      } else {
        const cell = siteCells.find((c) => Number(c.variable_id) === Number(variable));
        out[s.id] = cell
          ? { value: Number(cell.average), samples: Number(cell.samples), metric: activeVar?.unit || '' }
          : null;
      }
    }
    return out;
  }, [heatmap, geo, variable, activeVar]);

  const numeric = geo.map((s) => values[s.id]?.value).filter((v) => v !== undefined && v !== null);
  const vMin = numeric.length ? Math.min(...numeric) : 0;
  const vMax = numeric.length ? Math.max(...numeric) : 1;
  const maxSamples = Math.max(1, ...geo.map((s) => values[s.id]?.samples || 1));

  // P1 #18: umbral de referencia activo para la variable seleccionada. Se prioriza
  // el umbral con valor máximo (el más restrictivo) para colorear por cumplimiento.
  const refThreshold = useMemo(() => {
    if (!activeVar) return null;
    const matches = (refThresholds || []).filter((r) => Number(r.variable_id) === Number(activeVar.id));
    const withMax = matches.filter((r) => r.max_value !== null && r.max_value !== undefined);
    if (withMax.length) {
      return withMax.reduce((best, r) => (Number(r.max_value) < Number(best.max_value) ? r : best));
    }
    const withMin = matches.filter((r) => r.min_value !== null && r.min_value !== undefined);
    return withMin.length ? withMin[0] : null;
  }, [refThresholds, activeVar]);

  const radius = (s) => 8 + (Math.sqrt((values[s.id]?.samples || 1) / maxSamples) * 14);

  // Severidad respecto al umbral de referencia: ≤0.6 verde, 1.0 ámbar, ≥1.2 rojo.
  const severityT = (v) => {
    if (!refThreshold) return null;
    const maxV = refThreshold.max_value !== null && refThreshold.max_value !== undefined ? Number(refThreshold.max_value) : null;
    const minV = refThreshold.min_value !== null && refThreshold.min_value !== undefined ? Number(refThreshold.min_value) : null;
    let severity;
    if (maxV) severity = v / maxV;
    else if (minV) severity = minV / v;
    else return null;
    return Math.max(0, Math.min(1, (severity - 0.6) / 0.6));
  };

  const fill = (s) => {
    const v = values[s.id]?.value;
    if (v === undefined || v === null) return '#cbd5e1';
    if (mode === 'reference') {
      const t = severityT(v);
      return t === null ? '#cbd5e1' : colorFor(t);
    }
    if (vMax === vMin) return '#2f9e8f';
    return colorFor((v - vMin) / (vMax - vMin));
  };

  return (
    <>
      <Heading
        title="Mapa de estaciones"
        description="Distribución geográfica de las estaciones de monitoreo con sus valores agregados por variable."
      />
      <Notice error={error} />

      <section className="panel">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div style={{ maxWidth: 320 }}>
            <label>Variable a visualizar</label>
            <select className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
              <option value="all">Todas (total de muestras)</option>
              {variables?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.unit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Colorear por</label>
            <div className="flex gap-2">
              {[
                ['observed', 'Rango observado'],
                ['reference', 'Umbral de referencia'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={key === 'reference' && variable === 'all'}
                  onClick={() => setMode(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    mode === key
                      ? 'bg-leaf text-white border-leaf'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-leaf/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-sm muted max-w-md">
            {geo.length} de {sites?.length ?? 0} estaciones con coordenadas. El tamaño del círculo refleja el
            número de muestras; el color,{' '}
            {mode === 'reference'
              ? 'el cumplimiento del umbral de referencia activo'
              : 'el valor respecto al rango observado'}
            .
          </div>
        </div>

        {mode === 'reference' && (
          <p className="muted text-xs mb-4">
            {refThreshold ? (
              <>
                Umbral aplicado: <strong>{refThreshold.label}</strong>{' '}
                {refThreshold.min_value !== null ? `≥ ${refThreshold.min_value}` : ''}
                {refThreshold.min_value !== null && refThreshold.max_value !== null ? ' – ' : ''}
                {refThreshold.max_value !== null ? `≤ ${refThreshold.max_value}` : ''} · {refThreshold.source}.
                Escala: verde = holgado, ámbar = cercano al límite, rojo = supera el límite.
              </>
            ) : (
              'No hay un umbral de referencia activo para esta variable; se muestra el rango observado.'
            )}
          </p>
        )}

        <div className="relative rounded-2xl border border-slate-200 overflow-hidden bg-[#f8fbfa]">
          {geo.length ? (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              <defs>
                <linearGradient id="mapbg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#eef5f2" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width={W} height={H} fill="url(#mapbg)" />

              {/* Graticule */}
              {Array.from({ length: 5 }).map((_, i) => {
                const y = PAD + (i * (H - 2 * PAD)) / 4;
                const lat = projection.maxLat - (i / 4) * (projection.maxLat - projection.minLat);
                return (
                  <g key={`h${i}`}>
                    <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#dbe7e2" strokeDasharray="4 6" />
                    <text x={10} y={y + 4} fontSize="11" fill="#8aa399">
                      {lat.toFixed(3)}
                    </text>
                  </g>
                );
              })}
              {Array.from({ length: 5 }).map((_, i) => {
                const x = PAD + (i * (W - 2 * PAD)) / 4;
                const lon = projection.minLon + (i / 4) * (projection.maxLon - projection.minLon);
                return (
                  <g key={`v${i}`}>
                    <line x1={x} y1={PAD} x2={x} y2={H - PAD} stroke="#dbe7e2" strokeDasharray="4 6" />
                    <text x={x} y={H - 24} fontSize="11" fill="#8aa399" textAnchor="middle">
                      {lon.toFixed(3)}
                    </text>
                  </g>
                );
              })}

              {geo.map((s) => {
                const cx = projection.px(s.longitude);
                const cy = projection.py(s.latitude);
                return (
                  <g
                    key={s.id}
                    onMouseEnter={(e) => setHover({ s, x: cx, y: cy })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={cx} cy={cy} r={radius(s) + 6} fill={fill(s)} opacity="0.15" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius(s)}
                      fill={fill(s)}
                      stroke="#ffffff"
                      strokeWidth="2"
                      opacity={hover?.s.id === s.id ? 1 : 0.9}
                    />
                    <text x={cx} y={cy - radius(s) - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="#18312b">
                      {s.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="h-72 grid place-items-center muted">
              No hay estaciones con coordenadas registradas.
            </div>
          )}

          {hover && (
            <div
              className="absolute bg-ink text-white text-xs rounded-xl px-3 py-2 shadow-xl pointer-events-none"
              style={{
                left: `${(hover.x / W) * 100}%`,
                top: `${(hover.y / H) * 100}%`,
                transform: 'translate(-50%, -130%)',
                whiteSpace: 'nowrap',
              }}
            >
              <div className="font-bold">{hover.s.name}</div>
              <div>
                {activeVar ? `${activeVar.name}: ` : 'Muestras: '}
                {values[hover.s.id]?.value ?? 'sin datos'}
                {activeVar ? ` ${activeVar.unit}` : ''}
              </div>
              <div className="text-slate-300">Muestras: {values[hover.s.id]?.samples ?? 0}</div>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {geo.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
              onMouseEnter={() => setHover({ s, x: projection.px(s.longitude), y: projection.py(s.latitude) })}
              onMouseLeave={() => setHover(null)}
            >
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate text-ink">{s.name}</div>
                <div className="muted text-xs">
                  {Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-sm">
                  {values[s.id]?.value ?? '—'}
                  {activeVar && <span className="muted font-normal text-xs"> {activeVar.unit}</span>}
                </div>
                <div className="muted text-xs">{values[s.id]?.samples ?? 0} muestras</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
