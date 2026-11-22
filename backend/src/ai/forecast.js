// Motor de pronóstico: regresión Ridge sobre 3 rezagos, implementado en JavaScript puro
// (sin dependencias nativas). Mejoras P0/P1:
//  - A2: estandarización de los rezagos antes de regularizar (lambda con sentido físico).
//  - P1: validación walk-forward (Time-Series Cross-Validation) además del holdout 80/20.
//  - P1: intervalos de predicción conformales a partir de residuos del holdout.
//  - P1: análisis de regularidad del muestreo (coeficiente de variación de intervalos).
//  - P2: pronóstico multi-paso recursivo e importancia relativa de cada rezago.
// Solo usa observaciones válidas anteriores a cada objetivo (sin filtración temporal).

const LAGS = 3;

// Eliminación gaussiana con pivoteo parcial. Se mantiene por compatibilidad y pruebas.
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let p = 0; p < n; p++) {
    let pivot = p;
    for (let i = p + 1; i < n; i++) if (Math.abs(M[i][p]) > Math.abs(M[pivot][p])) pivot = i;
    if (Math.abs(M[pivot][p]) < 1e-10) throw Error('Datos insuficientes para ajuste estable');
    [M[p], M[pivot]] = [M[pivot], M[p]];
    const v = M[p][p];
    for (let j = p; j <= n; j++) M[p][j] /= v;
    for (let i = 0; i < n; i++) {
      if (i === p) continue;
      const f = M[i][p];
      for (let j = p; j <= n; j++) M[i][j] -= f * M[p][j];
    }
  }
  return M.map((row) => row[n]);
}

// Ejemplos supervisados: x = [1, lag1, lag2, lag3], y = valor objetivo.
export function makeExamples(series) {
  return series.slice(3).map((v, i) => ({ x: [1, series[i], series[i + 1], series[i + 2]], y: v }));
}

// Ajuste Ridge sobre rezagos estandarizados (media 0, desviación 1). No penaliza el intercepto.
export function fitModel(examples, lambda = 1) {
  const n = examples.length || 1;
  const mean = Array(LAGS).fill(0);
  const sd = Array(LAGS).fill(0);
  for (const { x } of examples) for (let j = 0; j < LAGS; j++) mean[j] += x[j + 1];
  for (let j = 0; j < LAGS; j++) mean[j] /= n;
  for (const { x } of examples) for (let j = 0; j < LAGS; j++) sd[j] += (x[j + 1] - mean[j]) ** 2;
  for (let j = 0; j < LAGS; j++) sd[j] = Math.sqrt(sd[j] / n) || 1;

  const d = LAGS + 1;
  const A = Array.from({ length: d }, () => Array(d).fill(0));
  const b = Array(d).fill(0);
  for (const { x, y } of examples) {
    const z = [1];
    for (let j = 0; j < LAGS; j++) z.push((x[j + 1] - mean[j]) / sd[j]);
    for (let i = 0; i < d; i++) {
      b[i] += z[i] * y;
      for (let j = 0; j < d; j++) A[i][j] += z[i] * z[j];
    }
  }
  for (let i = 1; i < d; i++) A[i][i] += lambda;
  return { mean, sd, theta: solve(A, b) };
}

// Predicción con un modelo ya ajustado. `window` = últimos 3 valores en escala original.
export function predictOne(model, window) {
  let s = model.theta[0];
  for (let j = 0; j < LAGS; j++) s += model.theta[j + 1] * ((window[j] - model.mean[j]) / model.sd[j]);
  return s;
}

// Pronóstico recursivo multi-paso: cada estimación alimenta la ventana del siguiente paso.
export function forecastPath(model, window, steps) {
  const out = [];
  let win = [...window];
  for (let h = 0; h < steps; h++) {
    const y = predictOne(model, win);
    out.push(y);
    win = [...win.slice(1), y];
  }
  return out;
}

// Importancia relativa de cada rezago (coeficientes estandarizados normalizados).
export function featureImportance(model) {
  const abs = model.theta.slice(1).map(Math.abs);
  const sum = abs.reduce((a, b) => a + b, 0) || 1;
  return abs.map((v, i) => ({ lag: i + 1, weight: model.theta[i + 1], importance: v / sum }));
}

export function metrics(actual, predicted) {
  const n = actual.length;
  if (!n) throw Error('Test vacío');
  const mae = actual.reduce((a, y, i) => a + Math.abs(y - predicted[i]), 0) / n;
  const rmse = Math.sqrt(actual.reduce((a, y, i) => a + (y - predicted[i]) ** 2, 0) / n);
  const mean = actual.reduce((a, b) => a + b, 0) / n;
  const den = actual.reduce((a, y) => a + (y - mean) ** 2, 0);
  const r2 = den > 0 ? 1 - actual.reduce((a, y, i) => a + (y - predicted[i]) ** 2, 0) / den : null;
  const smape =
    (actual.reduce((a, y, i) => {
      const d = Math.abs(y) + Math.abs(predicted[i]);
      return a + (d === 0 ? 0 : (2 * Math.abs(y - predicted[i])) / d);
    }, 0) /
      n) *
    100;
  return { mae, rmse, r2, smape };
}

// Cuantil conformal de residuos absolutos para el intervalo de predicción.
export function conformalMargin(residuals, level = 0.9) {
  const abs = residuals.map((r) => Math.abs(r)).sort((a, b) => a - b);
  if (!abs.length) return null;
  const n = abs.length;
  const rank = Math.min(n, Math.ceil((n + 1) * level));
  return abs[Math.max(0, rank - 1)];
}

// Regularidad del muestreo: coeficiente de variación de los intervalos entre mediciones.
export function analyzeRegularity(dates, { tolerance = 0.25 } = {}) {
  if (!Array.isArray(dates) || dates.length < 2)
    return { medianStepMs: null, cv: null, isRegular: false, gapCount: 0 };
  const steps = [];
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i] - dates[i - 1];
    if (d > 0) steps.push(d);
  }
  if (!steps.length) return { medianStepMs: null, cv: null, isRegular: false, gapCount: 0 };
  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const variance = steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : null;
  return { medianStepMs: median, cv, isRegular: cv !== null && cv <= tolerance, gapCount: steps.length };
}

// Validación walk-forward (origen rodante): N pliegues expansivos sobre la cola de la serie.
export function walkForwardCV(series, { folds = 5, lambda = 1, minTrain = 10 } = {}) {
  const examples = makeExamples(series);
  const n = examples.length;
  const testSize = Math.max(1, Math.floor(n / (folds + 1)));
  const rows = [];
  for (let f = 0; f < folds; f++) {
    const cut = n - (folds - f) * testSize;
    if (cut < minTrain) continue;
    const train = examples.slice(0, cut);
    const test = examples.slice(cut, cut + testSize);
    if (!test.length) continue;
    const model = fitModel(train, lambda);
    const act = test.map((e) => e.y);
    const yp = test.map((e) => predictOne(model, e.x.slice(1)));
    const base = test.map((e) => e.x[3]);
    const m = metrics(act, yp);
    const bmet = metrics(act, base);
    rows.push({
      fold: rows.length + 1,
      trainRows: train.length,
      testRows: test.length,
      mae: m.mae,
      rmse: m.rmse,
      r2: m.r2,
      baselineMae: bmet.mae,
      beatsBaseline: m.mae <= bmet.mae,
    });
  }
  const avg = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v !== null && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    folds: rows,
    foldCount: rows.length,
    aggregate: {
      mae: avg('mae'),
      rmse: avg('rmse'),
      r2: avg('r2'),
      baselineMae: avg('baselineMae'),
      winsBaseline: rows.filter((r) => r.beatsBaseline).length,
      total: rows.length,
    },
    method: 'walk_forward_tscv',
  };
}

// ---------------------------------------------------------------------------
// Diagnóstico estadístico (P1): ACF/PACF, límites de control y tendencia.
// ---------------------------------------------------------------------------

// Función error (Abramowitz & Stegun 7.1.26), precisión ~1.5e-7.
function erf(x) {
  const sign = Math.sign(x);
  const v = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * v);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-v * v);
  return sign * y;
}

// Función de distribución normal estándar acumulada.
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inversa aproximada de la normal estándar (Acklam).
function probit(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const ph = 1 - pl;
  let q;
  let r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Autocorrelación (ACF) de la serie hasta `maxLag`.
export function acf(series, maxLag = 12) {
  const n = series.length;
  if (n < 3) return { lags: [], values: [] };
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const denom = series.reduce((a, v) => a + (v - mean) ** 2, 0) || 1;
  const top = Math.min(maxLag, n - 2);
  const lags = [];
  const values = [];
  for (let k = 1; k <= top; k++) {
    let num = 0;
    for (let t = 0; t < n - k; t++) num += (series[t] - mean) * (series[t + k] - mean);
    lags.push(k);
    values.push(num / denom);
  }
  return { lags, values };
}

// Autocorrelación parcial (PACF) por recursión de Durbin-Levinson sobre la ACF.
export function pacf(series, maxLag = 12) {
  const { values: r } = acf(series, maxLag);
  const m = r.length;
  if (!m) return { lags: [], values: [] };
  const pac = [];
  const phi = Array.from({ length: m + 1 }, () => Array(m + 1).fill(0));
  pac.push(r[0]);
  phi[1][1] = r[0];
  for (let k = 2; k <= m; k++) {
    let num = r[k - 1];
    for (let j = 1; j < k; j++) num -= phi[k - 1][j] * r[k - j - 1];
    let den = 1;
    for (let j = 1; j < k; j++) den -= phi[k - 1][j] * r[j - 1];
    const val = den === 0 ? 0 : num / den;
    phi[k][k] = val;
    for (let j = 1; j < k; j++) phi[k][j] = phi[k - 1][j] - val * phi[k - 1][k - j];
    pac.push(val);
  }
  return { lags: Array.from({ length: m }, (_, i) => i + 1), values: pac };
}

// Límites de control estadístico (SPC) clásico y robusto. No son límites legales.
export function spcLimits(series, { k = 3 } = {}) {
  const clean = series.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n < 5) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  const variance = clean.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const sorted = [...clean].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const mad = [...clean.map((v) => Math.abs(v - median))].sort((a, b) => a - b);
  const madVal = n % 2 ? mad[(n - 1) / 2] : (mad[n / 2 - 1] + mad[n / 2]) / 2;
  const robustSd = madVal > 0 ? madVal / 0.6745 : 0;
  return {
    center: mean,
    sd,
    ucl: mean + k * sd,
    lcl: mean - k * sd,
    robustCenter: median,
    robustSd,
    robustUcl: robustSd > 0 ? median + k * robustSd : null,
    robustLcl: robustSd > 0 ? median - k * robustSd : null,
    k,
  };
}

// Test de tendencia Mann-Kendall con pendiente de Sen (no paramétrico).
export function mannKendall(series) {
  const x = series.filter((v) => Number.isFinite(v));
  const n = x.length;
  if (n < 4) return null;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(x[j] - x[i]);
  const counts = new Map();
  for (const v of x) counts.set(v, (counts.get(v) || 0) + 1);
  let tie = 0;
  for (const c of counts.values()) if (c > 1) tie += c * (c - 1) * (2 * c + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  let z = 0;
  if (variance > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(variance);
    else if (s < 0) z = (s + 1) / Math.sqrt(variance);
  }
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const tau = s / ((n * (n - 1)) / 2);
  const slopes = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) slopes.push((x[j] - x[i]) / (j - i));
  slopes.sort((a, b) => a - b);
  const senSlope = slopes.length
    ? slopes.length % 2
      ? slopes[(slopes.length - 1) / 2]
      : (slopes[slopes.length / 2 - 1] + slopes[slopes.length / 2]) / 2
    : null;
  return {
    n,
    s,
    z,
    pValue: p,
    tau,
    senSlope,
    direction: z > 0 ? 'up' : z < 0 ? 'down' : 'flat',
    significant: p < 0.05,
  };
}

// Diagnóstico de residuos: serie temporal, resumen, histograma y cuantiles QQ.
export function residualDiagnostics(actual, predicted) {
  const n = actual.length;
  const residuals = actual.map((y, i) => Number((y - predicted[i]).toFixed(6)));
  const mean = residuals.reduce((a, b) => a + b, 0) / n;
  const variance = residuals.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const sorted = [...residuals].sort((a, b) => a - b);

  const bins = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(n))));
  const min = sorted[0];
  const max = sorted[n - 1];
  const width = (max - min) / bins || 1;
  const histogram = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const r of residuals) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((r - min) / width)));
    histogram[idx].count += 1;
  }

  const qq = sorted.map((r, i) => ({
    theoretical: sd > 0 ? probit((i + 0.5) / n) : 0,
    sample: sd > 0 ? (r - mean) / sd : 0,
  }));

  return {
    residuals,
    summary: { n, mean, sd, min, max },
    histogram,
    qq,
    lag1: n > 1 ? residuals.slice(0, -1).reduce((a, r, i) => a + r * residuals[i + 1], 0) / (residuals.slice(0, -1).reduce((a, r) => a + r * r, 0) || 1) : null,
  };
}

export function forecast(series, { horizon = 3, lambda = 1, folds = 5, intervalLevel = 0.9 } = {}) {
  if (!Array.isArray(series) || series.length < 30 || series.some((v) => !Number.isFinite(v)))
    throw Error('Se necesitan al menos 30 mediciones numéricas válidas');

  const examples = makeExamples(series);
  const cut = Math.floor(examples.length * 0.8);
  if (cut < 10 || examples.length - cut < 5) throw Error('Serie insuficiente para evaluación temporal');

  const train = examples.slice(0, cut);
  const test = examples.slice(cut);
  const model = fitModel(train, lambda);
  const act = test.map((e) => e.y);
  const yp = test.map((e) => predictOne(model, e.x.slice(1)));
  const base = test.map((e) => e.x[3]);
  const score = metrics(act, yp);
  const reference = metrics(act, base);

  const residuals = act.map((y, i) => y - yp[i]);
  const margin = conformalMargin(residuals, intervalLevel);

  // Reentrenamiento con toda la serie para el pronóstico productivo.
  const full = fitModel(examples, lambda);
  const lastWindow = series.slice(-3);
  const predicted = predictOne(full, lastWindow);
  const path = forecastPath(full, lastWindow, Math.max(1, Math.floor(horizon)));

  // Banda aproximada por paso: el error de un pronóstico recursivo acumula
  // varianza ~h·σ², por lo que el margen crece con √h (supuesto de errores
  // independientes). Se documenta explícitamente para no sobreestimar confianza.
  const intervalPath =
    margin === null
      ? null
      : path.map((value, i) => {
          const step = i + 1;
          const stepMargin = margin * Math.sqrt(step);
          return { step, value, margin: stepMargin, lower: value - stepMargin, upper: value + stepMargin };
        });

  return {
    predicted,
    forecastPath: path,
    metrics: score,
    baseline: reference,
    interval:
      margin === null
        ? null
        : { level: intervalLevel, margin, lower: predicted - margin, upper: predicted + margin },
    intervalPath,
    holdout: { actual: act, predicted: yp },
    residualDiagnostics: residualDiagnostics(act, yp),
    autocorrelation: acf(series),
    partialAutocorrelation: pacf(series),
    featureImportance: featureImportance(full),
    crossValidation: walkForwardCV(series, { folds, lambda }),
    trainingRows: train.length,
    testingRows: test.length,
    model: 'ridge_lag3_v2_std',
    suitable: score.mae <= reference.mae,
    method: 'holdout_temporal_80_20',
  };
}
