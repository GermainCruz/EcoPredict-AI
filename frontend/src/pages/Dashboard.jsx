import React, { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { Filters, Heading, Notice, useRequest } from '../components/Shared';

export default function Dashboard() {
  const { data, error } = useRequest('/dashboard/summary');
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [series, setSeries] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const stats = data?.stats || {};
  const availability = data?.availability || [];

  useEffect(() => {
    if (!site && !variable && availability.length > 0) {
      setSite(String(availability[0].site_id));
      setVariable(String(availability[0].variable_id));
    }
  }, [availability, site, variable]);

  useEffect(() => {
    if (!site || !variable) {
      setSeries([]);
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
    return () => {
      active = false;
    };
  }, [site, variable]);

  return (
    <>
      <Heading
        title="Dashboard ambiental"
        description="Visibilidad de registros, indicadores y evolución temporal."
      />
      <Notice error={error} />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[
          ['Mediciones', stats.total ?? 0],
          ['Estaciones con datos', stats.sites ?? 0],
          ['Variables con datos', stats.variables ?? 0],
          ['Calidad sospechosa', stats.suspect ?? 0],
        ].map(([k, v]) => (
          <div className="panel" key={k}>
            <div className="muted text-sm">{k}</div>
            <div className="text-3xl font-bold mt-3">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-5">
        <section className="panel xl:col-span-3">
          <h2 className="h2">Tendencia de las mediciones</h2>
          <Filters
            sites={sites || []}
            variables={variables || []}
            site={site}
            setSite={setSite}
            variable={variable}
            setVariable={setVariable}
          />
          {availability.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {availability.map((a) => {
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
          )}
          <div className="h-72 mt-5">
            {seriesLoading ? (
              <div className="h-full grid place-items-center muted">Cargando serie temporal...</div>
            ) : site && variable && series.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series.map((x) => ({
                    ...x,
                    date: new Date(x.date).toLocaleDateString('es-PE'),
                    value: Number(x.value),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4eee9" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line dataKey="value" stroke="#087968" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full grid place-items-center muted text-center px-4">
                No hay registros válidos para esta combinación de estación y variable. Elige una de
                las series disponibles arriba.
              </div>
            )}
          </div>
        </section>

        <section className="panel xl:col-span-2">
          <h2 className="h2">Últimas mediciones</h2>
          <div className="space-y-3">
            {data?.latest?.length ? (
              data.latest.map((x) => (
                <div
                  className="flex justify-between gap-3 border-b border-slate-100 pb-3"
                  key={x.id}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{x.variable}</div>
                    <div className="muted text-xs">{x.site}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">
                      {x.value} <span className="muted font-normal text-xs">{x.unit}</span>
                    </div>
                    <div className="muted text-xs">
                      {new Date(x.measured_at).toLocaleDateString('es-PE')}
                    </div>
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
    </>
  );
}
