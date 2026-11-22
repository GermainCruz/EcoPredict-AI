// Detección de anomalías estadísticas sobre series ambientales (P2).
// Enfoque robusto sin dependencias: z-score modificado (mediana / MAD) combinado con IQR.
// No se enmascaran valores: los datos se evalúan tal cual y se marca el motivo de la bandera.

const MAD_TO_SIGMA = 0.6745;

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function quantile(values, q) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return a[base + 1] !== undefined ? a[base] + rest * (a[base + 1] - a[base]) : a[base];
}

// values: array de números (puede contener no finitos; se preserva el índice).
// Devuelve puntos con {score, isAnomaly, reasons} y un resumen con los límites usados.
export function detectAnomalies(values, { zThreshold = 3.5, iqrFactor = 1.5 } = {}) {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n < 5) {
    return {
      points: values.map(() => ({ score: 0, isAnomaly: false, reasons: [] })),
      summary: { n, median: null, mad: null, lowerFence: null, upperFence: null, flagged: 0 },
    };
  }

  const med = median(clean);
  const mad = median(clean.map((v) => Math.abs(v - med)));
  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - iqrFactor * iqr;
  const upperFence = q3 + iqrFactor * iqr;
  const scaled = mad > 0 ? mad / MAD_TO_SIGMA : 0;

  const points = values.map((v) => {
    if (!Number.isFinite(v)) return { score: 0, isAnomaly: false, reasons: [] };
    const z = scaled > 0 ? (v - med) / scaled : 0;
    const reasons = [];
    if (Math.abs(z) > zThreshold) reasons.push('zscore');
    if (v < lowerFence || v > upperFence) reasons.push('iqr');
    return { score: Number(z.toFixed(3)), isAnomaly: reasons.length > 0, reasons };
  });

  return {
    points,
    summary: {
      n,
      median: med,
      mad,
      lowerFence,
      upperFence,
      flagged: points.filter((p) => p.isAnomaly).length,
    },
  };
}
