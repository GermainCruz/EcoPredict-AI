import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';

export default function Predictions() {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const { data: summary } = useRequest('/dashboard/summary');
  const { data: history, reload } = useRequest('/predictions');

  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [result, setResult] = useState(null);
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
        body: { site_id: Number(site), variable_id: Number(variable) },
      });
      setResult(r);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Heading
        title="Inteligencia artificial"
        description="Pronóstico de una variable con evaluación cronológica y baseline."
      />
      <Notice error={error} />

      <div className="grid xl:grid-cols-5 gap-5">
        <section className="panel xl:col-span-2">
          <h2 className="h2">Nueva predicción</h2>
          <form onSubmit={run} className="space-y-4">
            <div>
              <label>Estación</label>
              <select
                required
                className="form-field"
                value={site}
                onChange={(e) => setSite(e.target.value)}
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
                value={variable}
                onChange={(e) => setVariable(e.target.value)}
              >
                <option value="">Seleccionar</option>
                {variables?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>

            {site && variable && (
              <div>
                <Badge tone={validCount >= 30 ? 'success' : 'warning'}>
                  {validCount >= 30
                    ? `${validCount} observaciones válidas — Apto para entrenar`
                    : `${validCount} observaciones válidas — Se requieren al menos 30`}
                </Badge>
              </div>
            )}

            {trainable.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1.5">
                  Series listas para entrenar:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {trainable.map((a) => {
                    const active =
                      String(a.site_id) === String(site) &&
                      String(a.variable_id) === String(variable);
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
              Se necesitan al menos 30 registros válidos para la combinación elegida. Se separan
              cronológicamente entrenamiento y prueba (80/20).
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
              <div className="text-sm muted">Próximo valor estimado</div>
              <div className="text-4xl font-bold my-3">
                {Number(result.prediction.predicted_value).toFixed(3)}
              </div>
              <div className="muted text-sm">
                Objetivo: {new Date(result.prediction.target_date).toLocaleString('es-PE')}
              </div>
              <div className="grid grid-cols-3 gap-3 mt-5">
                {[
                  ['MAE', result.run.metrics.model.mae],
                  ['RMSE', result.run.metrics.model.rmse],
                  ['R²', result.run.metrics.model.r2],
                ].map(([k, v]) => (
                  <div key={k} className="bg-mist rounded-xl p-3">
                    <div className="muted text-xs">{k}</div>
                    <div className="font-bold text-lg">
                      {v === null ? 'N/D' : Number(v).toFixed(3)}
                    </div>
                  </div>
                ))}
              </div>
              <p
                className={`mt-5 text-sm font-semibold ${
                  result.suitable ? 'text-leaf' : 'text-red-700'
                }`}
              >
                {result.warning}
              </p>
              <p className="muted text-sm mt-2">
                Baseline MAE: {Number(result.run.metrics.baseline.mae).toFixed(3)}; evaluación con{' '}
                {result.run.testing_rows} muestras de prueba.
              </p>
            </>
          ) : (
            <div className="muted">
              Los resultados y métricas aparecerán después de una ejecución válida.
            </div>
          )}
        </section>
      </div>

      <section className="panel mt-5">
        <h2 className="h2">Historial de ejecuciones</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha de ejecución</th>
                <th>Estación</th>
                <th>Variable</th>
                <th>Estimación</th>
                <th>Fecha objetivo</th>
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
                  <td>{x.predicted_value}</td>
                  <td>{new Date(x.target_date).toLocaleString('es-PE')}</td>
                  <td>{Number(x.metrics.model.mae).toFixed(3)}</td>
                  <td>{Number(x.metrics.baseline.mae).toFixed(3)}</td>
                  <td>{x.metrics.suitable ? 'Sí' : 'No'}</td>
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
