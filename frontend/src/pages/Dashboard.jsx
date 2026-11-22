import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, AlertTriangle, Info, Activity, BellRing, ShieldCheck, MapPinned, LineChart } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Filters, Heading, Notice, useRequest } from '../components/Shared';
import Plot, { baseLayout, downloadFigure } from '../components/Plot';

// Genera una interpretación textual de la serie temporal según estación y variable.
// El texto combina contexto de la estación, significado de la variable, tendencia
// observada, valores extremos y presencia de alertas abiertas.
function buildInterpretation({ siteName, variableName, variableCode, unit, series, openAlerts, topSeverity }) {
  if (!series || series.length === 0) {
    return null;
  }
  const values = series.map((x) => Number(x.value));
  const first = values[0];
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const delta = last - first;
  const pct = first !== 0 ? (delta / Math.abs(first)) * 100 : 0;

  // Tendencia general.
  let trendText;
  if (Math.abs(pct) < 3) trendText = 'se mantiene relativamente estable';
  else if (pct > 0) trendText = `muestra una tendencia al alza de ${pct.toFixed(1)}%`;
  else trendText = `muestra una tendencia a la baja de ${Math.abs(pct).toFixed(1)}%`;

  // Contexto por estación.
  const siteContext = {
    'Estación de referencia':
      'Es la estación de referencia; sus valores sirven como línea base para comparar con las demás estaciones.',
    'Estación Centro Urbano':
      'Corresponde a una zona urbana; los contaminantes atmosféricos suelen reflejar tráfico y actividad comercial.',
    'Estación Cuenca Río Moche':
      'Es un punto de control hidrológico; los parámetros de calidad de agua (pH, turbidez, temperatura) son especialmente relevantes.',
    'Estación Parque Industrial':
      'Es una zona industrial; se espera mayor concentración de material particulado (PM2.5, PM10) por emisiones de procesos.',
  };
  const siteDesc = siteContext[siteName] || 'Estación de monitoreo ambiental.';

  // Explicación por variable.
  const varContext = {
    PM25: 'Material particulado fino (< 2.5 µm). Valores elevados afectan la salud respiratoria; la OMS recomienda mantener la media anual por debajo de 5 µg/m³.',
    PM10: 'Material particulado (< 10 µm). Incluye polvo y partículas gruesas; niveles altos se asocian a mala calidad del aire.',
    PH: 'Potencial de hidrógeno del agua. Valores neutros (6.5–8.5) son adecuados para la mayoría de usos; desviaciones indican contaminación ácida o alcalina.',
    TURB: 'Turbidez del agua. Mide la claridad; valores altos indican mayor carga de sedimentos o partículas en suspensión.',
    WTEMP: 'Temperatura del agua. Afecta la solubilidad del oxígeno y la vida acuática; incrementos abruptos pueden deberse a descargas térmicas.',
    TEMP: 'Temperatura ambiental. Influye en la calidad del aire y la evaporación; valores extremos pueden afectar la salud.',
    HUM: 'Humedad relativa. Afecta la percepción térmica y la dispersión de contaminantes; valores muy altos favorecen la formación de niebla.',
  };
  const varDesc = varContext[variableCode] || `Variable ambiental ${variableName}.`;

  const lines = [
    `${siteDesc} La variable <strong>${variableName}</strong> (${unit}) ${trendText} en el periodo analizado.`,
    `${varDesc}`,
    `En esta serie, el promedio es <strong>${avg.toFixed(2)} ${unit}</strong>, con un mínimo de ${min.toFixed(2)} y un máximo de ${max.toFixed(2)}.`,
  ];

  if (openAlerts && openAlerts > 0) {
    const sev = topSeverity === 'critical' ? 'críticas' : topSeverity === 'warning' ? 'de advertencia' : 'informativas';
    lines.push(
      `<strong class="text-red-600">Se detectaron ${openAlerts} alerta${openAlerts > 1 ? 's' : ''} abierta${openAlerts > 1 ? 's' : ''} ${sev}</strong> para esta combinación de estación y variable.`
    );
  } else {
    lines.push(`Actualmente no hay alertas abiertas para esta combinación de estación y variable.`);
  }

  return lines;
}

// Colores y acentos por tono para las tarjetas KPI del panel ejecutivo.
const KPI_TONE = {
  leaf: { chip: 'bg-emerald-50 text-emerald-700', value: 'text-ink' },
  sky: { chip: 'bg-sky-50 text-sky-700', value: 'text-ink' },
  amber: { chip: 'bg-amber-50 text-amber-700', value: 'text-amber-600' },
  red: { chip: 'bg-red-50 text-red-700', value: 'text-red-600' },
};

const SEVERITY_META = {
  critical: { label: 'Crítica', color: '#d93025' },
  warning: { label: 'Advertencia', color: '#f0a63a' },
  info: { label: 'Informativa', color: '#3b7dd8' },
};

const STATUS_META = {
  open: { label: 'Abiertas', color: '#d93025' },
  acknowledged: { label: 'Reconocidas', color: '#2f9e8f' },
  dismissed: { label: 'Descartadas', color: '#94a3b8' },
};

export default function Dashboard() {
  const { data, error } = useRequest('/dashboard/summary');
  const { data: heatmap } = useRequest('/dashboard/heatmap');
  const { data: alertSummary } = useRequest('/alerts/summary');
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [series, setSeries] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [anomalies, setAnomalies] = useState([]);
  const trendRef = useRef(null);
  const heatRef = useRef(null);
  const sevRef = useRef(null);
  const statusRef = useRef(null);
  const stationRef = useRef(null);

  const stats = data?.stats || {};
  const availability = data?.availability || [];
  const alertsKpi = data?.alerts || {};

  // Tasa de datos válidos sobre el total registrado (indicador de calidad).
  const validRate = stats.total > 0 ? ((stats.valid ?? 0) / stats.total) * 100 : 0;

  // Matriz de alertas por estado y severidad, derivada de /alerts/summary.
  const alertMatrix = useMemo(() => {
    const statuses = ['open', 'acknowledged', 'dismissed'];
    const severities = ['critical', 'warning', 'info'];
    const m = Object.fromEntries(statuses.map((s) => [s, { critical: 0, warning: 0, info: 0 }]));
    for (const r of alertSummary?.rows || []) {
      if (m[r.status] && m[r.status][r.severity] !== undefined) m[r.status][r.severity] = r.count;
    }
    const sum = (s) => severities.reduce((a, sev) => a + m[s][sev], 0);
    const openBySeverity = { critical: m.open.critical, warning: m.open.warning, info: m.open.info };
    const byStatus = { open: sum('open'), acknowledged: sum('acknowledged'), dismissed: sum('dismissed') };
    const total = byStatus.open + byStatus.acknowledged + byStatus.dismissed;
    return { m, statuses, severities, openBySeverity, openTotal: byStatus.open, byStatus, total };
  }, [alertSummary]);

  // Ranking de estaciones por alertas abiertas (agrega la disponibilidad por estación).
  const stationAlerts = useMemo(() => {
    const bySite = {};
    for (const a of availability) {
      const n = a.open_alerts || 0;
      if (n > 0) bySite[a.site_name] = (bySite[a.site_name] || 0) + n;
    }
    return Object.entries(bySite)
      .map(([name, count]) => ({ name, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 8);
  }, [availability]);

  // Lectura ejecutiva: resumen en lenguaje natural del estado del sistema.
  const execReading = useMemo(() => {
    const open = alertsKpi.open ?? 0;
    const crit = alertsKpi.critical ?? 0;
    const parts = [
      `${stats.total ?? 0} mediciones registradas en ${stats.sites ?? 0} estaciones y ${stats.variables ?? 0} variables.`,
      `La tasa de datos válidos es del ${validRate.toFixed(1)}%.`,
    ];
    if (open > 0) {
      parts.push(
        `Hay ${open} alerta${open > 1 ? 's' : ''} abierta${open > 1 ? 's' : ''}${
          crit > 0 ? `, ${crit} crítica${crit > 1 ? 's' : ''}` : ''
        }.`
      );
    } else {
      parts.push('No hay alertas abiertas en este momento.');
    }
    return parts;
  }, [stats, alertsKpi, validRate]);

  // Tarjetas KPI del panel ejecutivo.
  const kpis = [
    {
      label: 'Mediciones registradas',
      value: (stats.total ?? 0).toLocaleString('es-PE'),
      sub: `${(stats.valid ?? 0).toLocaleString('es-PE')} válidas`,
      tone: 'leaf',
      icon: Activity,
    },
    { label: 'Estaciones monitoreadas', value: stats.sites ?? 0, sub: 'con datos cargados', tone: 'sky', icon: MapPinned },
    { label: 'Variables ambientales', value: stats.variables ?? 0, sub: 'con seguimiento', tone: 'sky', icon: LineChart },
    {
      label: 'Tasa de datos válidos',
      value: `${validRate.toFixed(1)}%`,
      sub: `${stats.suspect ?? 0} sospechosas · ${stats.rejected ?? 0} rechazadas`,
      tone: validRate >= 95 ? 'leaf' : validRate >= 80 ? 'amber' : 'red',
      icon: ShieldCheck,
    },
    {
      label: 'Alertas abiertas',
      value: alertsKpi.open ?? 0,
      sub: `${alertsKpi.critical ?? 0} críticas · ${alertsKpi.warning ?? 0} advertencias`,
      tone: (alertsKpi.open ?? 0) > 0 ? 'red' : 'leaf',
      icon: BellRing,
    },
  ];

  // Figura: dona de severidad de alertas abiertas.
  const severityDonut = useMemo(() => {
    const { openBySeverity, openTotal } = alertMatrix;
    return [
      {
        type: 'pie',
        hole: 0.62,
        sort: false,
        labels: ['Crítica', 'Advertencia', 'Informativa'],
        values: [openBySeverity.critical, openBySeverity.warning, openBySeverity.info],
        marker: { colors: ['#d93025', '#f0a63a', '#3b7dd8'] },
        textinfo: 'value',
        textfont: { size: 13, color: '#18312b' },
        hovertemplate: '%{label}: %{value} (%{percent})<extra></extra>',
        showlegend: openTotal > 0,
      },
    ];
  }, [alertMatrix]);

  // Figura: barras apiladas de alertas por estado, segmentadas por severidad.
  const statusBarData = useMemo(() => {
    const { m, severities, statuses } = alertMatrix;
    return severities.map((sev) => ({
      type: 'bar',
      x: statuses.map((s) => STATUS_META[s].label),
      y: statuses.map((s) => m[s][sev]),
      name: SEVERITY_META[sev].label,
      marker: { color: SEVERITY_META[sev].color },
      hovertemplate: '%{x} · ' + SEVERITY_META[sev].label + ': %{y}<extra></extra>',
    }));
  }, [alertMatrix]);

  // Figura: ranking horizontal de estaciones por alertas abiertas.
  const stationBarData = useMemo(() => {
    const rows = [...stationAlerts].reverse();
    return [
      {
        type: 'bar',
        orientation: 'h',
        y: rows.map((r) => r.name),
        x: rows.map((r) => r.count),
        marker: { color: '#d93025' },
        text: rows.map((r) => r.count),
        textposition: 'outside',
        textfont: { color: '#18312b', size: 12 },
        hovertemplate: '%{y}: %{x} alertas abiertas<extra></extra>',
      },
    ];
  }, [stationAlerts]);

  // Figura: indicador tipo gauge de la tasa de datos válidos.
  const qualityGauge = useMemo(
    () => [
      {
        type: 'indicator',
        mode: 'gauge+number',
        value: Number(validRate.toFixed(1)),
        number: { suffix: '%', font: { size: 40, color: '#18312b' } },
        gauge: {
          axis: { range: [0, 100], ticksuffix: '%', tickfont: { size: 10 } },
          bar: { color: '#087968' },
          bgcolor: '#ffffff',
          borderwidth: 0,
          steps: [
            { range: [0, 80], color: '#fdecea' },
            { range: [80, 95], color: '#fff8e1' },
            { range: [95, 100], color: '#e6f4ea' },
          ],
          threshold: { line: { color: '#d93025', width: 3 }, thickness: 0.85, value: 95 },
        },
      },
    ],
    [validRate]
  );

  // Prioridad de series para selección rápida: primero las que tienen alertas
  // abiertas, luego las de mayor volumen de datos. Se limita a 4 opciones para
  // no saturar la interfaz; el resto sigue siendo accesible desde los filtros.
  const priorityAvailability = useMemo(() => {
    const withAlerts = availability.filter((a) => (a.open_alerts || 0) > 0);
    const withoutAlerts = availability
      .filter((a) => !(a.open_alerts || 0))
      .sort((a, b) => b.valid_count - a.valid_count);
    return [...withAlerts, ...withoutAlerts].slice(0, 4);
  }, [availability]);

  useEffect(() => {
    if (!site && !variable && priorityAvailability.length > 0) {
      setSite(String(priorityAvailability[0].site_id));
      setVariable(String(priorityAvailability[0].variable_id));
    }
  }, [priorityAvailability, site, variable]);

  useEffect(() => {
    if (!site || !variable) {
      setSeries([]);
      setAnomalies([]);
      return;
    }
    let active = true;
    setSeriesLoading(true);
    api(`/dashboard/timeseries?site_id=${site}&variable_id=${variable}`)
      .then((rows) => {
        if (active) setSeries(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setSeries([]);
      })
      .finally(() => {
        if (active) setSeriesLoading(false);
      });
    // P0 #4: valores atípicos de la combinación para superponerlos en la serie.
    api(`/quality/anomalies?site_id=${site}&variable_id=${variable}&threshold=3.5&limit=100`)
      .then((r) => {
        if (active) setAnomalies(Array.isArray(r?.items) ? r.items : []);
      })
      .catch(() => {
        if (active) setAnomalies([]);
      });
    return () => {
      active = false;
    };
  }, [site, variable]);

  const currentMeta = availability.find(
    (a) => String(a.site_id) === String(site) && String(a.variable_id) === String(variable)
  );

  const interpretation = useMemo(
    () =>
      buildInterpretation({
        siteName: currentMeta?.site_name,
        variableName: currentMeta?.variable_name,
        variableCode: currentMeta?.variable_code,
        unit: currentMeta?.unit,
        series,
        openAlerts: currentMeta?.open_alerts || 0,
        topSeverity: currentMeta?.top_severity,
      }),
    [currentMeta, series]
  );

  const trendData = useMemo(() => {
    const traces = [
      {
        x: series.map((x) => new Date(x.date).toISOString().slice(0, 10)),
        y: series.map((x) => Number(x.value)),
        customdata: series.map((x) => x.samples),
        type: 'scatter',
        mode: 'lines+markers',
        name: currentMeta ? `${currentMeta.variable_name} (${currentMeta.unit})` : 'Serie',
        line: { color: '#087968', width: 2.5 },
        marker: { size: 5, color: '#2f9e8f' },
        hovertemplate: '%{x}<br>Promedio: %{y:.3f}<br>Muestras: %{customdata}<extra></extra>',
      },
    ];
    // P0 #4: superpone los valores atípicos (marcados como sospechosos o |z| ≥ 3.5).
    if (anomalies.length) {
      const byDate = new Map(series.map((x) => [new Date(x.date).toISOString().slice(0, 10), Number(x.value)]));
      const ax = [];
      const ay = [];
      const adata = [];
      for (const a of anomalies) {
        const day = new Date(a.measured_at).toISOString().slice(0, 10);
        ax.push(day);
        ay.push(byDate.has(day) ? byDate.get(day) : Number(a.value));
        adata.push([Number(a.value), a.anomaly_score === null ? null : Number(a.anomaly_score), a.quality_status]);
      }
      traces.push({
        x: ax,
        y: ay,
        customdata: adata,
        type: 'scatter',
        mode: 'markers',
        name: `Atípicos (${ax.length})`,
        marker: { size: 11, color: '#d93025', symbol: 'x', line: { width: 1, color: '#ffffff' } },
        hovertemplate:
          '%{x}<br>Valor medido: %{customdata[0]:.3f}<br>Puntaje: %{customdata[1]:.2f}σ<br>Calidad: %{customdata[2]}<extra></extra>',
      });
    }
    return traces;
  }, [series, currentMeta, anomalies]);

  // Mapa de calor: valor relativo (z-score por variable) para resaltar estaciones atípicas.
  const heat = useMemo(() => {
    if (!heatmap?.sites || !heatmap?.cells) return null;
    const siteList = heatmap.sites;
    const varList = heatmap.variables.filter((v) =>
      heatmap.cells.some((c) => Number(c.variable_id) === Number(v.id))
    );
    const byVar = {};
    for (const c of heatmap.cells) {
      (byVar[c.variable_id] ||= []).push(Number(c.average));
    }
    const statsByVar = {};
    for (const [vid, vals] of Object.entries(byVar)) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      statsByVar[vid] = { mean, sd: Math.sqrt(variance) };
    }
    const z = [];
    const customdata = [];
    for (const s of siteList) {
      const zr = [];
      const cr = [];
      for (const v of varList) {
        const cell = heatmap.cells.find(
          (c) => Number(c.site_id) === Number(s.id) && Number(c.variable_id) === Number(v.id)
        );
        if (!cell) {
          zr.push(null);
          cr.push(null);
        } else {
          const { mean, sd } = statsByVar[v.id];
          zr.push(sd > 0 ? (Number(cell.average) - mean) / sd : 0);
          cr.push([`${s.name} · ${v.name}`, `Promedio: ${cell.average} ${v.unit}`, `Muestras: ${cell.samples}`]);
        }
      }
      z.push(zr);
      customdata.push(cr);
    }
    return { sites: siteList, variables: varList, z, customdata };
  }, [heatmap]);

  const heatData = useMemo(() => {
    if (!heat) return [];
    const allZ = heat.z.flat().filter((v) => v !== null && Number.isFinite(v));
    const maxAbs = allZ.length ? Math.max(...allZ.map(Math.abs)) : 0;
    // Rango dinámico: al menos ±1.5σ para contraste, hasta ±3σ.
    const range = Math.max(1.5, Math.min(3, maxAbs || 2));
    return [
      {
        type: 'heatmap',
        x: heat.variables.map((v) => `${v.name} (${v.unit})`),
        y: heat.sites.map((s) => s.name),
        z: heat.z,
        customdata: heat.customdata,
        // Escala explícita: verde = por debajo de la media (z < 0),
        // amarillo = cerca de la media, rojo = por encima (z > 0).
        colorscale: [
          [0, '#1b9e3e'],
          [0.25, '#6cc24a'],
          [0.5, '#f5d742'],
          [0.75, '#ef8c3a'],
          [1, '#d93025'],
        ],
        zmid: 0,
        zmin: -range,
        zmax: range,
        hovertemplate:
          '%{customdata[0]}<br>%{customdata[1]}<br>%{customdata[2]}<br>Relativo: %{z:.2f}σ<extra></extra>',
        colorbar: { title: 'z', thickness: 12 },
      },
    ];
  }, [heat]);

  return (
    <>
      <Heading
        title="Panel ejecutivo ambiental"
        description="Visión ejecutiva del monitoreo: indicadores clave, estado de alertas y evolución temporal."
      />
      <Notice error={error} />

      {/* --- Fila 1: KPIs ejecutivos --- */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
        {kpis.map(({ label, value, sub, tone, icon: Icon }) => {
          const t = KPI_TONE[tone];
          return (
            <div className="panel" key={label}>
              <div className="flex items-center justify-between gap-2">
                <div className="muted text-sm">{label}</div>
                <span className={`p-1.5 rounded-lg ${t.chip}`}>
                  <Icon size={16} />
                </span>
              </div>
              <div className={`text-3xl font-bold mt-3 ${t.value}`}>{value}</div>
              <div className="muted text-xs mt-1">{sub}</div>
            </div>
          );
        })}
      </div>

      {/* --- Fila 4: tendencia + últimas mediciones --- */}
      <div className="grid xl:grid-cols-5 gap-5">
        <section className="panel xl:col-span-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="h2 mb-0">Tendencia de las mediciones</h2>
            {series.length > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() =>
                  downloadFigure(trendRef.current?.querySelector('.js-plotly-plot'), 'ecopredict_tendencia')
                }
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            )}
          </div>
          <div className="mt-4">
            <Filters
              sites={sites || []}
              variables={variables || []}
              site={site}
              setSite={setSite}
              variable={variable}
              setVariable={setVariable}
            />
          </div>
          {priorityAvailability.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {priorityAvailability.map((a) => {
                const active = String(a.site_id) === String(site) && String(a.variable_id) === String(variable);
                const hasAlerts = (a.open_alerts || 0) > 0;
                return (
                  <button
                    key={`${a.site_id}-${a.variable_id}`}
                    type="button"
                    onClick={() => {
                      setSite(String(a.site_id));
                      setVariable(String(a.variable_id));
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1.5 ${
                      active
                        ? 'bg-leaf text-white border-leaf'
                        : hasAlerts
                        ? 'bg-red-50 text-red-700 border-red-200 hover:border-red-400'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-leaf/60'
                    }`}
                  >
                    {hasAlerts && <AlertTriangle size={12} />}
                    {a.site_name} · {a.variable_name} ({a.valid_count})
                  </button>
                );
              })}
              {availability.length > priorityAvailability.length && (
                <span className="text-xs muted self-center px-1.5">
                  +{availability.length - priorityAvailability.length} más (usa los filtros)
                </span>
              )}
            </div>
          )}
          <div className="mt-5" ref={trendRef}>
            {seriesLoading ? (
              <div className="h-72 grid place-items-center muted">Cargando serie temporal...</div>
            ) : site && variable && series.length > 0 ? (
              <Plot
                style={{ height: 320 }}
                data={trendData}
                layout={baseLayout({ xaxis: { gridcolor: '#e4eee9', type: 'date' } })}
              />
            ) : (
              <div className="h-72 grid place-items-center muted text-center px-4">
                No hay registros válidos para esta combinación de estación y variable. Elige una de las
                series disponibles arriba.
              </div>
            )}
          </div>
          {interpretation && site && variable && series.length > 0 && (
            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info size={16} className="text-sky-600" />
                <h3 className="text-sm font-bold text-sky-900">Interpretación de la tendencia</h3>
              </div>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {interpretation.map((line, idx) => (
                  <li key={idx} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: line }} />
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel xl:col-span-2">
          <h2 className="h2">Últimas mediciones</h2>
          <div className="space-y-3">
            {data?.latest?.length ? (
              data.latest.map((x) => (
                <div className="flex justify-between gap-3 border-b border-slate-100 pb-3" key={x.id}>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{x.variable}</div>
                    <div className="muted text-xs">{x.site}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">
                      {x.value} <span className="muted font-normal text-xs">{x.unit}</span>
                    </div>
                    <div className="muted text-xs">{new Date(x.measured_at).toLocaleDateString('es-PE')}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Aún no hay mediciones.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="h2 mb-0">Mapa de calor por estación y variable</h2>
            <p className="muted text-sm mt-1">
              Valor relativo por variable (z-score): <span className="text-emerald-600 font-medium">verde</span> = por
              debajo de la media, <span className="text-amber-500 font-medium">amarillo</span> = cerca de la media,{' '}
              <span className="text-red-600 font-medium">rojo</span> = por encima. Pasa el cursor para ver el promedio
              real y el número de muestras.
            </p>
          </div>
          {heat && (
            <button
              type="button"
              className="btn-secondary text-xs py-1.5 px-3"
              onClick={() => downloadFigure(heatRef.current?.querySelector('.js-plotly-plot'), 'ecopredict_heatmap')}
            >
              <Download size={14} /> PNG 600 DPI
            </button>
          )}
        </div>
        <div className="mt-4" ref={heatRef}>
          {heat ? (
            <Plot
              style={{ height: Math.max(260, heat.sites.length * 46 + 120) }}
              data={heatData}
              layout={baseLayout({ hovermode: 'closest', margin: { l: 190, r: 20, t: 20, b: 90 } })}
            />
          ) : (
            <p className="muted">Sin datos suficientes para el mapa de calor.</p>
          )}
        </div>
      </section>

      <section className="panel mt-5">
        <h2 className="h2">Estadísticas por variable</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Unidad</th>
                <th>Muestras válidas</th>
                <th>Promedio</th>
                <th>Mínimo</th>
                <th>Máximo</th>
              </tr>
            </thead>
            <tbody>
              {data?.byVariable?.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.unit}</td>
                  <td>{x.samples}</td>
                  <td>{x.average ?? '—'}</td>
                  <td>{x.minimum ?? '—'}</td>
                  <td>{x.maximum ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Lectura ejecutiva --- */}
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 mt-6 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Info size={16} className="text-emerald-700" />
          <h3 className="text-sm font-bold text-emerald-900">Lectura ejecutiva</h3>
          {(alertsKpi.open ?? 0) > 0 && <Badge tone="danger">{alertsKpi.open} abiertas</Badge>}
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">{execReading.join(' ')}</p>
      </div>

      {/* --- Fila 2: estado de alertas (severidad + estado) --- */}
      <div className="grid xl:grid-cols-2 gap-5 mb-5">
        <section className="panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="h2 mb-0">Alertas abiertas por severidad</h2>
              <p className="muted text-sm mt-1">Distribución de las alertas sin resolver según su criticidad.</p>
            </div>
            {alertMatrix.openTotal > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() => downloadFigure(sevRef.current?.querySelector('.js-plotly-plot'), 'ecopredict_alertas_severidad')}
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            )}
          </div>
          <div className="mt-3" ref={sevRef}>
            {alertMatrix.openTotal > 0 ? (
              <Plot
                style={{ height: 300 }}
                data={severityDonut}
                layout={baseLayout({
                  showlegend: true,
                  legend: { orientation: 'h', y: -0.08 },
                  margin: { l: 10, r: 10, t: 10, b: 10 },
                  annotations: [
                    {
                      text: `<b>${alertMatrix.openTotal}</b><br>abiertas`,
                      x: 0.5,
                      y: 0.5,
                      showarrow: false,
                      font: { size: 15, color: '#18312b' },
                    },
                  ],
                })}
              />
            ) : (
              <div className="h-[300px] grid place-items-center muted text-center px-4">
                No hay alertas abiertas. El sistema se encuentra dentro de los umbrales configurados.
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="h2 mb-0">Alertas por estado y severidad</h2>
              <p className="muted text-sm mt-1">Histórico segmentado por estado de gestión y criticidad.</p>
            </div>
            {alertMatrix.total > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() => downloadFigure(statusRef.current?.querySelector('.js-plotly-plot'), 'ecopredict_alertas_estado')}
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            )}
          </div>
          <div className="mt-3" ref={statusRef}>
            {alertMatrix.total > 0 ? (
              <Plot
                style={{ height: 300 }}
                data={statusBarData}
                layout={baseLayout({ barmode: 'stack', hovermode: 'x unified', showlegend: true })}
              />
            ) : (
              <div className="h-[300px] grid place-items-center muted text-center px-4">
                Aún no se han generado alertas en el sistema.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* --- Fila 3: ranking de estaciones + gauge de calidad --- */}
      <div className="grid xl:grid-cols-2 gap-5 mb-5">
        <section className="panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="h2 mb-0">Estaciones con más alertas abiertas</h2>
              <p className="muted text-sm mt-1">Prioriza la revisión por estación según el número de alertas sin resolver.</p>
            </div>
            {stationAlerts.length > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() => downloadFigure(stationRef.current?.querySelector('.js-plotly-plot'), 'ecopredict_alertas_estacion')}
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            )}
          </div>
          <div className="mt-3" ref={stationRef}>
            {stationAlerts.length > 0 ? (
              <Plot
                style={{ height: Math.max(280, stationAlerts.length * 44 + 80) }}
                data={stationBarData}
                layout={baseLayout({
                  hovermode: 'closest',
                  showlegend: false,
                  margin: { l: 180, r: 40, t: 20, b: 40 },
                  xaxis: { gridcolor: '#e4eee9', title: { text: 'Alertas abiertas' } },
                })}
              />
            ) : (
              <div className="h-[280px] grid place-items-center muted text-center px-4">
                Ninguna estación registra alertas abiertas.
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <h2 className="h2">Calidad de los datos</h2>
          <p className="muted text-sm mt-1">
            Proporción de mediciones válidas sobre el total. La línea roja marca el umbral objetivo del 95%.
          </p>
          <div className="mt-3">
            <Plot style={{ height: 300 }} data={qualityGauge} layout={baseLayout({ margin: { l: 20, r: 20, t: 20, b: 10 } })} />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2 text-center">
            {[
              ['Válidas', stats.valid ?? 0, 'text-emerald-600'],
              ['Sospechosas', stats.suspect ?? 0, 'text-amber-600'],
              ['Rechazadas', stats.rejected ?? 0, 'text-red-600'],
            ].map(([k, v, cls]) => (
              <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 py-2.5">
                <div className={`text-xl font-bold ${cls}`}>{v}</div>
                <div className="muted text-xs mt-0.5">{k}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
