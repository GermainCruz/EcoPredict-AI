import React, { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';

const fmtMs = (ms) => {
  if (!ms) return '—';
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};

const completenessTone = (c) => (c === null ? 'neutral' : c >= 90 ? 'success' : c >= 70 ? 'warning' : 'danger');

export default function Quality() {
  const { data: completeness, error } = useRequest('/quality/completeness');
  const [threshold, setThreshold] = useState(3.5);
  const { data: anomalies, error: anomaliesError } = useRequest(`/quality/anomalies?threshold=${threshold}&limit=200`);

  const items = completeness?.items || [];
  const summary = items.reduce(
    (acc, x) => {
      acc.total += x.total;
      acc.valid += x.valid;
      acc.suspect += x.suspect;
      acc.rejected += x.rejected;
      if (x.completeness !== null) {
        acc.completenessSum += x.completeness;
        acc.completenessN += 1;
      }
      return acc;
    },
    { total: 0, valid: 0, suspect: 0, rejected: 0, completenessSum: 0, completenessN: 0 }
  );
  const avgCompleteness = summary.completenessN ? summary.completenessSum / summary.completenessN : null;

  return (
    <>
      <Heading
        title="Calidad de datos"
        description="Completitud, huecos de muestreo y revisión de valores atípicos detectados durante la ingesta."
      />
      <Notice error={error || anomaliesError} />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[
          ['Mediciones totales', summary.total],
          ['Completitud media', avgCompleteness === null ? '—' : `${avgCompleteness.toFixed(1)}%`],
          ['Valores sospechosos', summary.suspect],
          ['Valores rechazados', summary.rejected],
        ].map(([k, v], i) => (
          <div className="panel" key={k}>
            <div className="muted text-sm">{k}</div>
            <div className={`text-3xl font-bold mt-3 ${i >= 2 && v > 0 ? 'text-amber-600' : ''}`}>{v}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2 className="h2">Completitud por estación y variable</h2>
        <p className="muted text-sm mb-4">
          La completitud compara los registros válidos con lo esperado según el paso de muestreo mediano.
          Los huecos grandes corresponden a intervalos superiores al doble del paso mediano.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estación</th>
                <th>Variable</th>
                <th>Total</th>
                <th>Válidos</th>
                <th>Sospechosos</th>
                <th>Rechazados</th>
                <th>Paso mediano</th>
                <th>Completitud</th>
                <th>Huecos grandes</th>
                <th>Hueco máximo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={`${x.site_id}-${x.variable_id}`}>
                  <td className="font-medium text-ink">{x.site_name}</td>
                  <td>
                    {x.variable_name} <span className="muted">({x.unit})</span>
                  </td>
                  <td>{x.total}</td>
                  <td>{x.valid}</td>
                  <td className={x.suspect > 0 ? 'text-amber-700 font-semibold' : ''}>{x.suspect}</td>
                  <td className={x.rejected > 0 ? 'text-red-700 font-semibold' : ''}>{x.rejected}</td>
                  <td>{fmtMs(x.median_step_ms)}</td>
                  <td>
                    {x.completeness === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <Badge tone={completenessTone(x.completeness)}>{x.completeness.toFixed(1)}%</Badge>
                    )}
                  </td>
                  <td className={x.large_gaps > 0 ? 'text-amber-700 font-semibold' : ''}>{x.large_gaps}</td>
                  <td>{fmtMs(x.max_gap_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <p className="muted p-4">No hay mediciones para analizar.</p>}
        </div>
      </section>

      <section className="panel mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2 mb-0">Revisión de valores atípicos</h2>
          <div style={{ maxWidth: 220 }}>
            <label>Umbral de puntaje (σ)</label>
            <select
              className="form-field py-1.5"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            >
              {[2, 2.5, 3, 3.5, 4, 5].map((t) => (
                <option key={t} value={t}>
                  |z| ≥ {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted text-sm mb-4">
          Se listan las mediciones marcadas como sospechosas o cuyo puntaje robusto (z-score modificado)
          iguala o supera el umbral seleccionado. La marca no implica error: orienta la verificación manual.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estación</th>
                <th>Variable</th>
                <th>Valor</th>
                <th>Puntaje</th>
                <th>Calidad</th>
                <th>Procedencia</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {anomalies?.items?.map((a) => {
                const score = a.anomaly_score === null || a.anomaly_score === undefined ? null : Number(a.anomaly_score);
                const isOutlier = score !== null && Math.abs(score) >= threshold;
                return (
                  <tr key={a.id}>
                    <td>{new Date(a.measured_at).toLocaleString('es-PE')}</td>
                    <td className="font-medium text-ink">{a.site_name}</td>
                    <td>{a.variable_name}</td>
                    <td className="font-bold">
                      {a.value} <span className="muted font-normal">{a.unit}</span>
                    </td>
                    <td>
                      {score === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            isOutlier ? 'text-amber-700' : 'text-slate-500'
                          }`}
                        >
                          {isOutlier && <AlertTriangle size={13} />}
                          {score.toFixed(2)}σ
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={a.quality_status === 'suspect' ? 'warning' : 'neutral'}>{a.quality_status}</Badge>
                    </td>
                    <td>
                      <Badge tone="info">{a.source_type}</Badge>
                    </td>
                    <td className="max-w-[220px] truncate muted" title={a.notes || ''}>
                      {a.notes || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!anomalies?.items?.length && (
            <p className="muted p-4">No se detectaron valores atípicos con el umbral seleccionado.</p>
          )}
        </div>
        <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4 flex gap-2.5">
          <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700 leading-relaxed">
            Los puntajes de atipicidad se calculan con z-score modificado (MAD) y reglas de rango
            intercuartílico durante la ingesta. Un valor atípico puede corresponder a un evento real; se
            recomienda confirmarlo antes de descartarlo.
          </p>
        </div>
      </section>
    </>
  );
}
