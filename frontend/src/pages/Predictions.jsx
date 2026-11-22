import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';
import Plot, { baseLayout, downloadFigure } from '../components/Plot';

const fmt = (v, d = 3) => (v === null || v === undefined ? 'N/D' : Number(v).toFixed(d));

export default function Predictions() {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const { data: summary } = useRequest('/dashboard/summary');
  const { data: history, reload } = useRequest('/predictions');

  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [horizon, setHorizon] = useState(3);
  const [folds, setFolds] = useState(5);
  const [result, setResult] = useState(null);
  const [series, setSeries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const availability = summary?.availability || [];
  const trainable = availability.filter((a) => a.valid_count >= 30);

  useEffect(() => {
    if (!site && !variable && trainable.length > 0) {
      setSite(String(trainable[0].site_id));
      setVariable(String(trainable[0].variable_id));
    }
  }, [trainable, site, variable]);

  const currentMatch = availability.find(
    (a) => String(a.site_id) === String(site) && String(a.variable_id) === String(variable)
  );
  const validCount = currentMatch ? currentMatch.valid_count : 0;

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await api('/predictions/run', {
        method: 'POST',
        body: { site_id: Number(site), variable_id: Number(variable), horizon: Number(horizon), folds: Number(folds) },
      });
      setResult(r);
      reload();
      const hist = await api(`/dashboard/timeseries?site_id=${site}&variable_id=${variable}`).catch(() => []);
      setSeries(Array.isArray(hist) ? hist : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const metrics = result?.run?.metrics || null;
  const model = metrics?.model || null;
  const baseline = metrics?.baseline || null;
  const interval = metrics?.interval || null;
  const cv = metrics?.crossValidation || null;
  const importance = metrics?.featureImportance || [];

  const forecastData = useMemo(() => {
    if (!result?.predictions?.length) return [];
    const hist = series.map((s) => ({ x: new Date(s.date).toISOString().slice(0, 10), y: Number(s.value) }));
    const preds = result.predictions.map((p) => ({
      x: new Date(p.target_date).toISOString().slice(0, 10),
      y: Number(p.predicted_value),
      step: p.horizon_step,
    }));
    const bridge = hist.length ? [{ x: hist.at(-1).x, y: hist.at(-1).y, step: 0 }] : [];
    const unit = currentMatch?.unit || '';
    const traces = [
      {
        x: hist.map((h) => h.x),
        y: hist.map((h) => h.y),
        type: 'scatter',
        mode: 'lines',
        name: 'Histórico',
        line: { color: '#687b74', width: 1.8 },
        hovertemplate: '%{x}<br>Histórico: %{y:.3f}<extra></extra>',
      },
    ];
    // P1: banda de predicción por paso (el margen crece con √h).
    const band = metrics?.intervalPath;
    if (Array.isArray(band) && band.length) {
      const bx = [...bridge, ...preds].map((p) => p.x);
      const upper = [bridge.length ? bridge[0].y : null, ...band.map((b) => b.upper)];
      const lower = [bridge.length ? bridge[0].y : null, ...band.map((b) => b.lower)];
      traces.push({
        x: bx,
        y: upper,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0 },
        hoverinfo: 'skip',
        showlegend: false,
      });
      traces.push({
        x: bx,
        y: lower,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(8,121,104,0.15)',
        name: 'Banda de predicción',
        hoverinfo: 'skip',
        showlegend: false,
      });
    }
    traces.push({
      x: [...bridge, ...preds].map((p) => p.x),
      y: [...bridge, ...preds].map((p) => p.y),
      customdata: [...bridge, ...preds].map((p) => p.step),
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Pronóstico',
      line: { color: '#087968', width: 2.5, dash: 'dot' },
      marker: { size: 8, color: '#087968' },
      hovertemplate: `Paso %{customdata}<br>%{x}<br>Estimado: %{y:.3f} ${unit}<extra></extra>`,
    });
    return traces;
  }, [result, series, currentMatch, metrics]);

  // P1 #8: backtest de holdout temporal (observado vs predicho) con línea identidad.
  const backtestData = useMemo(() => {
    const h = metrics?.holdout;
    if (!h?.actual?.length) return [];
    const vals = [...h.actual, ...h.predicted];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return [
      {
        x: h.predicted,
        y: h.actual,
        customdata: h.actual.map((a, i) => h.predicted[i]),
        type: 'scatter',
        mode: 'markers',
        name: 'Observado vs predicho',
        marker: { size: 6, color: '#2f9e8f', opacity: 0.75 },
        hovertemplate: 'Predicho: %{x:.3f}<br>Observado: %{y:.3f}<extra></extra>',
      },
      {
        x: [lo, hi],
        y: [lo, hi],
        type: 'scatter',
        mode: 'lines',
        name: 'Identidad',
        line: { color: '#d93025', width: 1.5, dash: 'dash' },
        hoverinfo: 'skip',
      },
    ];
  }, [metrics]);

  // P1 #9: diagnóstico de residuos (histograma y QQ normal).
  const residualData = useMemo(() => {
    const r = metrics?.residualDiagnostics;
    if (!r) return { hist: [], qq: [] };
    const hist = [
      {
        x: r.histogram.map((b) => Number(((b.from + b.to) / 2).toFixed(4))),
        y: r.histogram.map((b) => b.count),
        type: 'bar',
        marker: { color: '#67c3b4' },
        hovertemplate: 'Residuo ≈ %{x:.3f}<br>Frecuencia: %{y}<extra></extra>',
      },
    ];
    const qq = [
      {
        x: r.qq.map((p) => Number(p.theoretical.toFixed(4))),
        y: r.qq.map((p) => Number(p.sample.toFixed(4))),
        type: 'scatter',
        mode: 'markers',
        marker: { size: 5, color: '#087968', opacity: 0.8 },
        hovertemplate: 'Teórico: %{x:.3f}<br>Muestra: %{y:.3f}<extra></extra>',
      },
    ];
    const lim = Math.max(1, ...r.qq.map((p) => Math.abs(p.theoretical)));
    qq.push({
      x: [-lim, lim],
      y: [-lim, lim],
      type: 'scatter',
      mode: 'lines',
      line: { color: '#d93025', width: 1.3, dash: 'dash' },
      hoverinfo: 'skip',
      showlegend: false,
    });
    return { hist, qq };
  }, [metrics]);

  // P1 #9: autocorrelación (ACF) y autocorrelación parcial (PACF).
  const acfData = useMemo(() => {
    const a = metrics?.autocorrelation;
    const p = metrics?.partialAutocorrelation;
    const traces = [];
    if (a?.lags?.length) {
      traces.push({
        x: a.lags,
        y: a.values.map((v) => Number(v.toFixed(4))),
        type: 'bar',
        name: 'ACF',
        marker: { color: '#087968' },
        hovertemplate: 'Rezago %{x}<br>ACF: %{y:.3f}<extra></extra>',
      });
    }
    if (p?.lags?.length) {
      traces.push({
        x: p.lags,
        y: p.values.map((v) => Number(v.toFixed(4))),
        type: 'bar',
        name: 'PACF',
        marker: { color: '#f0a63a' },
        hovertemplate: 'Rezago %{x}<br>PACF: %{y:.3f}<extra></extra>',
      });
    }
    return traces;
  }, [metrics]);

  const importanceData = useMemo(
    () =>
      importance.length
        ? [
            {
              type: 'bar',
              x: importance.map((i) => `Rezago ${i.lag}`),
              y: importance.map((i) => Number(i.importance)),
              marker: { color: '#2f9e8f' },
              hovertemplate: '%{x}<br>Importancia: %{y:.1%}<extra></extra>',
            },
          ]
        : [],
    [importance]
  );

  return (
    <>
      <Heading
        title="Inteligencia artificial"
        description="Pronóstico multi-paso con evaluación cronológica, walk-forward, intervalos e interpretabilidad."
      />
      <Notice error={error} />

      <div className="grid xl:grid-cols-5 gap-5">
        <section className="panel xl:col-span-2">
          <h2 className="h2">Nueva predicción</h2>
          <form onSubmit={run} className="space-y-4">
            <div>
              <label>Estación</label>
              <select required className="form-field" value={site} onChange={(e) => setSite(e.target.value)}>
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
              <select required className="form-field" value={variable} onChange={(e) => setVariable(e.target.value)}>
                <option value="">Seleccionar</option>
                {variables?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label>Horizonte (pasos)</label>
                <select className="form-field" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Pliegues walk-forward</label>
                <select className="form-field" value={folds} onChange={(e) => setFolds(e.target.value)}>
                  {[3, 4, 5, 6, 8, 10].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {site && variable && (
              <Badge tone={validCount >= 30 ? 'success' : 'warning'}>
                {validCount >= 30
                  ? `${validCount} observaciones válidas — Apto para entrenar`
                  : `${validCount} observaciones válidas — Se requieren al menos 30`}
              </Badge>
            )}

            {trainable.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1.5">Series listas para entrenar:</div>
                <div className="flex flex-wrap gap-1.5">
                  {trainable.map((a) => {
                    const active = String(a.site_id) === String(site) && String(a.variable_id) === String(variable);
                    return (
                      <button
                        key={`${a.site_id}-${a.variable_id}`}
                        type="button"
                        onClick={() => {
                          setSite(String(a.site_id));
                          setVariable(String(a.variable_id));
                          setError('');
                        }}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${
                          active
                            ? 'bg-leaf text-white border-leaf'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-leaf/60'
                        }`}
                      >
                        {a.site_name} · {a.variable_name} ({a.valid_count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="muted text-sm">
              Se necesitan al menos 30 registros válidos. Se evalúa con holdout temporal 80/20 y validación
              walk-forward de {folds} pliegues.
            </p>
            <button className="btn w-full" disabled={loading || (site && variable && validCount < 30)}>
              {loading ? 'Evaluando…' : 'Entrenar y predecir'}
            </button>
          </form>
        </section>

        <section className="panel xl:col-span-3">
          <h2 className="h2">Resultado del modelo</h2>
          {result ? (
            <>
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <div className="text-sm muted">Próximo valor estimado (paso 1)</div>
                  <div className="text-4xl font-bold my-2">
                    {fmt(result.predictions?.[0]?.predicted_value)}
                  </div>
                  <div className="muted text-sm">
                    Objetivo: {new Date(result.predictions?.[0]?.target_date).toLocaleString('es-PE')}
                  </div>
                  {interval && (
                    <div className="mt-2 text-sm">
                      <span className="muted">Intervalo {(interval.level * 100).toFixed(0)}%: </span>
                      <span className="font-semibold">
                        [{fmt(interval.lower)}, {fmt(interval.upper)}]
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['MAE', model?.mae],
                    ['RMSE', model?.rmse],
                    ['R²', model?.r2],
                    ['sMAPE %', model?.smape],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-mist rounded-xl p-3">
                      <div className="muted text-xs">{k}</div>
                      <div className="font-bold text-lg">{fmt(v)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge tone={result.suitable ? 'success' : 'danger'}>
                  {result.suitable ? 'Supera el baseline' : 'No supera el baseline'}
                </Badge>
                <Badge tone="neutral">Baseline MAE: {fmt(baseline?.mae)}</Badge>
                <Badge tone="info">Prueba: {result.run?.testing_rows} muestras</Badge>
                {metrics?.regularity && (
                  <Badge tone={metrics.regularity.isRegular ? 'success' : 'warning'}>
                    Muestreo {metrics.regularity.isRegular ? 'regular' : 'irregular'} (CV{' '}
                    {metrics.regularity.cv !== null ? fmt(metrics.regularity.cv, 2) : 'N/D'})
                  </Badge>
                )}
              </div>

              {result.warnings?.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {result.warnings.map((w) => (
                    <li key={w} className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="muted">Los resultados y métricas aparecerán después de una ejecución válida.</div>
          )}
        </section>
      </div>

      {result && (
        <>
          <section className="panel mt-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="h2 mb-0">Trayectoria pronosticada</h2>
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() => downloadFigure(document.querySelector('#forecast-chart .js-plotly-plot'), 'ecopredict_pronostico')}
              >
                <Download size={14} /> PNG 600 DPI
              </button>
            </div>
            {series.length > 0 ? (
              <div id="forecast-chart" className="mt-4">
                <Plot
                  style={{ height: 360 }}
                  data={forecastData}
                  layout={baseLayout({ xaxis: { gridcolor: '#e4eee9', type: 'date' } })}
                />
              </div>
            ) : (
              <p className="muted mt-3">Sin histórico disponible para graficar la trayectoria.</p>
            )}
            <div className="table-wrap mt-5">
              <table>
                <thead>
                  <tr>
                    <th>Paso</th>
                    <th>Fecha objetivo</th>
                    <th>Valor estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.predictions?.map((p) => (
                    <tr key={p.id}>
                      <td>{p.horizon_step}</td>
                      <td>{new Date(p.target_date).toLocaleString('es-PE')}</td>
                      <td className="font-bold">{fmt(p.predicted_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid xl:grid-cols-2 gap-5 mt-5">
            <section className="panel">
              <h2 className="h2">Validación walk-forward (TS-CV)</h2>
              {cv?.folds?.length ? (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Pliegue</th>
                          <th>MAE</th>
                          <th>Baseline</th>
                          <th>R²</th>
                          <th>¿Supera?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cv.folds.map((f) => (
                          <tr key={f.fold}>
                            <td>{f.fold}</td>
                            <td>{fmt(f.mae)}</td>
                            <td>{fmt(f.baselineMae)}</td>
                            <td>{fmt(f.r2)}</td>
                            <td>
                              <Badge tone={f.beatsBaseline ? 'success' : 'danger'}>
                                {f.beatsBaseline ? 'Sí' : 'No'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted text-sm mt-3">
                    Promedio MAE: {fmt(cv.aggregate?.mae)} · Baseline: {fmt(cv.aggregate?.baselineMae)} · Gana el
                    baseline en {cv.aggregate?.winsBaseline}/{cv.aggregate?.total} pliegues.
                  </p>
                </>
              ) : (
                <p className="muted">Sin pliegues suficientes para la validación.</p>
              )}
            </section>

            <section className="panel">
              <h2 className="h2">Importancia de los rezagos</h2>
              {importance.length ? (
                <Plot style={{ height: 260 }} data={importanceData} layout={baseLayout({ hovermode: 'closest' })} />
              ) : (
                <p className="muted">Sin información de importancia.</p>
              )}
            </section>
          </div>

          <div className="grid xl:grid-cols-2 gap-5 mt-5">
            <section className="panel">
              <h2 className="h2">Backtest: observado vs predicho</h2>
              <p className="muted text-sm mb-3">
                Conjunto de prueba temporal (20%). Los puntos sobre la línea de identidad indican una
                predicción perfecta; la dispersión refleja el error real del modelo.
              </p>
              {backtestData.length ? (
                <Plot
                  style={{ height: 300 }}
                  data={backtestData}
                  layout={baseLayout({
                    hovermode: 'closest',
                    xaxis: { title: 'Predicho', gridcolor: '#e4eee9' },
                    yaxis: { title: 'Observado', gridcolor: '#e4eee9' },
                  })}
                />
              ) : (
                <p className="muted">Sin datos de holdout.</p>
              )}
            </section>

            <section className="panel">
              <h2 className="h2">Autocorrelación (ACF / PACF)</h2>
              <p className="muted text-sm mb-3">
                La ACF mide la dependencia global de la serie con sus rezagos; la PACF aísla la
                contribución directa de cada rezago. Rezagos significativos justifican el modelo lag-3.
              </p>
              {acfData.length ? (
                <Plot
                  style={{ height: 300 }}
                  data={acfData}
                  layout={baseLayout({ hovermode: 'closest', barmode: 'group', xaxis: { title: 'Rezago', dtick: 1 } })}
                />
              ) : (
                <p className="muted">Sin datos de autocorrelación.</p>
              )}
            </section>
          </div>

          <div className="grid xl:grid-cols-2 gap-5 mt-5">
            <section className="panel">
              <h2 className="h2">Distribución de residuos</h2>
              {metrics?.residualDiagnostics ? (
                <>
                  <Plot
                    style={{ height: 260 }}
                    data={residualData.hist}
                    layout={baseLayout({ hovermode: 'closest', xaxis: { title: 'Residuo' }, yaxis: { title: 'Frecuencia' } })}
                  />
                  <p className="muted text-sm mt-3">
                    Media: {fmt(metrics.residualDiagnostics.summary?.mean)} · Desv. estándar:{' '}
                    {fmt(metrics.residualDiagnostics.summary?.sd)} · Autocorr. lag-1:{' '}
                    {fmt(metrics.residualDiagnostics.lag1, 3)}
                  </p>
                </>
              ) : (
                <p className="muted">Sin diagnóstico de residuos.</p>
              )}
            </section>

            <section className="panel">
              <h2 className="h2">Gráfico Q-Q normal</h2>
              {residualData.qq.length ? (
                <>
                  <Plot
                    style={{ height: 300 }}
                    data={residualData.qq}
                    layout={baseLayout({
                      hovermode: 'closest',
                      xaxis: { title: 'Cuantil teórico', gridcolor: '#e4eee9' },
                      yaxis: { title: 'Cuantil muestral', gridcolor: '#e4eee9' },
                    })}
                  />
                  <p className="muted text-sm mt-3">
                    La proximidad a la diagonal sugiere residuos aproximadamente normales (supuesto del
                    intervalo conformal).
                  </p>
                </>
              ) : (
                <p className="muted">Sin cuantiles disponibles.</p>
              )}
            </section>
          </div>
        </>
      )}

      <section className="panel mt-5">
        <h2 className="h2">Historial de ejecuciones</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha de ejecución</th>
                <th>Estación</th>
                <th>Variable</th>
                <th>Pasos</th>
                <th>Estimación (paso 1)</th>
                <th>MAE</th>
                <th>Baseline MAE</th>
                <th>Supera baseline</th>
              </tr>
            </thead>
            <tbody>
              {history?.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.executed_at).toLocaleString('es-PE')}</td>
                  <td>{x.site_name}</td>
                  <td>{x.variable_name}</td>
                  <td>{x.predictions?.length ?? 1}</td>
                  <td>{x.predicted_value}</td>
                  <td>{fmt(x.metrics?.model?.mae)}</td>
                  <td>{fmt(x.metrics?.baseline?.mae)}</td>
                  <td>
                    <Badge tone={x.metrics?.suitable ? 'success' : 'danger'}>{x.metrics?.suitable ? 'Sí' : 'No'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history?.length && <p className="muted p-4">Sin ejecuciones registradas.</p>}
        </div>
      </section>
    </>
  );
}
