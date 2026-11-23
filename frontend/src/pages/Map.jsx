import React, { useMemo, useState } from 'react';
import {
  Wind,
  Droplets,
  Thermometer,
  CloudSun,
  X,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Compass,
} from 'lucide-react';
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
  const [selectedSite, setSelectedSite] = useState(null);

  const {
    data: weatherData,
    loading: weatherLoading,
    error: weatherError,
    reload: reloadWeather,
  } = useRequest(selectedSite ? `/weather/${selectedSite.id}` : null);

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

  // Umbral de referencia activo para la variable seleccionada
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

  const radius = (s) => 8 + Math.sqrt((values[s.id]?.samples || 1) / maxSamples) * 14;

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
        description="Distribución geográfica de las estaciones de monitoreo con sus valores agregados y clima en tiempo real."
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
            {geo.length} de {sites?.length ?? 0} estaciones con coordenadas. Haz clic en una estación para consultar su clima y diagnóstico de dispersión atmosférica.
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
                const isSelected = selectedSite?.id === s.id;
                return (
                  <g
                    key={s.id}
                    onClick={() => setSelectedSite(isSelected ? null : s)}
                    onMouseEnter={() => setHover({ s, x: cx, y: cy })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isSelected && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius(s) + 12}
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2.5"
                        strokeDasharray="4 3"
                        opacity="0.8"
                      />
                    )}
                    <circle cx={cx} cy={cy} r={radius(s) + 6} fill={fill(s)} opacity="0.15" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius(s)}
                      fill={fill(s)}
                      stroke={isSelected ? '#059669' : '#ffffff'}
                      strokeWidth={isSelected ? '3' : '2'}
                      opacity={hover?.s.id === s.id || isSelected ? 1 : 0.9}
                    />
                    <text
                      x={cx}
                      y={cy - radius(s) - 6}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight={isSelected ? '700' : '600'}
                      fill={isSelected ? '#065f46' : '#18312b'}
                    >
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
              <div className="text-emerald-300 text-[10px] mt-0.5">Clic para ver clima en tiempo real</div>
            </div>
          )}
        </div>

        {/* Panel de Clima en Tiempo Real y Dispersión Atmosférica */}
        {selectedSite && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <CloudSun size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-ink">
                      Condiciones Meteorológicas en Tiempo Real — {selectedSite.name}
                    </h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Open-Meteo API
                    </span>
                  </div>
                  <p className="text-xs muted">
                    Coordenadas: {Number(selectedSite.latitude).toFixed(4)}, {Number(selectedSite.longitude).toFixed(4)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reloadWeather}
                  disabled={weatherLoading}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs flex items-center gap-1.5 font-medium"
                  title="Actualizar datos meteorológicos"
                >
                  <RefreshCw size={13} className={weatherLoading ? 'animate-spin' : ''} />
                  <span>Actualizar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSite(null)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                  title="Cerrar panel"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {weatherLoading && (
              <div className="py-8 text-center text-sm muted flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin text-leaf" />
                Consultando satélite y modelo meteorológico en Open-Meteo...
              </div>
            )}

            {weatherError && <p className="error text-xs">{weatherError}</p>}

            {weatherData && !weatherData.available && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-2">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{weatherData.message}</p>
                  {weatherData.details && <p className="text-xs text-amber-700 mt-1">{weatherData.details}</p>}
                </div>
              </div>
            )}

            {weatherData?.available && weatherData.weather && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1 font-medium">
                      <Thermometer size={14} className="text-rose-500" />
                      <span>Temperatura</span>
                    </div>
                    <div className="text-xl font-extrabold text-ink">
                      {weatherData.weather.temperature !== null ? `${weatherData.weather.temperature} °C` : '—'}
                    </div>
                    <div className="text-[11px] muted mt-0.5">
                      Sensación: {weatherData.weather.apparent_temperature !== null ? `${weatherData.weather.apparent_temperature} °C` : '—'}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1 font-medium">
                      <Droplets size={14} className="text-sky-500" />
                      <span>Humedad Relativa</span>
                    </div>
                    <div className="text-xl font-extrabold text-ink">
                      {weatherData.weather.relative_humidity !== null ? `${weatherData.weather.relative_humidity} %` : '—'}
                    </div>
                    <div className="text-[11px] muted mt-0.5">
                      Precipitación: {weatherData.weather.precipitation ?? 0} mm
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1 font-medium">
                      <Wind size={14} className="text-teal-600" />
                      <span>Velocidad del Viento</span>
                    </div>
                    <div className="text-xl font-extrabold text-ink">
                      {weatherData.weather.wind_speed !== null ? `${weatherData.weather.wind_speed} km/h` : '—'}
                    </div>
                    <div className="text-[11px] muted mt-0.5">
                      Dirección: {weatherData.weather.wind_direction_cardinal} ({weatherData.weather.wind_direction}°)
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1 font-medium">
                      <CloudSun size={14} className="text-amber-500" />
                      <span>Estado del Cielo</span>
                    </div>
                    <div className="text-sm font-bold text-ink truncate mt-1">
                      {weatherData.weather.weather_description}
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium mt-1">
                      Enlace satelital activo
                    </div>
                  </div>
                </div>

                {weatherData.dispersion && (
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      weatherData.dispersion.tone === 'success'
                        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                        : weatherData.dispersion.tone === 'warning'
                        ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                        : 'bg-sky-50/80 border-sky-200 text-sky-950'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {weatherData.dispersion.tone === 'success' ? (
                        <CheckCircle2 size={18} className="text-emerald-600" />
                      ) : weatherData.dispersion.tone === 'warning' ? (
                        <AlertTriangle size={18} className="text-amber-600" />
                      ) : (
                        <Wind size={18} className="text-sky-600" />
                      )}
                    </div>
                    <div className="text-xs">
                      <div className="font-bold text-sm mb-0.5 flex items-center gap-2">
                        <span>Diagnóstico de Dispersión Atmosférica:</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            weatherData.dispersion.tone === 'success'
                              ? 'bg-emerald-200/80 text-emerald-900'
                              : weatherData.dispersion.tone === 'warning'
                              ? 'bg-amber-200/80 text-amber-900'
                              : 'bg-sky-200/80 text-sky-900'
                          }`}
                        >
                          {weatherData.dispersion.label}
                        </span>
                      </div>
                      <p className="leading-relaxed opacity-90">{weatherData.dispersion.diagnostic}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {geo.map((s) => {
            const isSelected = selectedSite?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setSelectedSite(isSelected ? null : s)}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition ${
                  isSelected
                    ? 'border-leaf bg-emerald-50/50 ring-1 ring-leaf'
                    : 'border-slate-200 hover:border-leaf/60 hover:bg-slate-50/50'
                }`}
                onMouseEnter={() => setHover({ s, x: projection.px(s.longitude), y: projection.py(s.latitude) })}
                onMouseLeave={() => setHover(null)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate text-ink">{s.name}</span>
                    {isSelected && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-semibold">
                        Activa
                      </span>
                    )}
                  </div>
                  <div className="muted text-xs">
                    {Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">
                    {values[s.id]?.value ?? '—'}
                    {activeVar && <span className="muted font-normal text-xs"> {activeVar.unit}</span>}
                  </div>
                  <div className="text-xs text-leaf font-medium">Ver clima en vivo →</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
