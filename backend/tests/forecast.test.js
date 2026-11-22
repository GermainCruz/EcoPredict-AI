import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forecast,
  metrics,
  makeExamples,
  solve,
  fitModel,
  forecastPath,
  conformalMargin,
  analyzeRegularity,
  featureImportance,
  acf,
  pacf,
  spcLimits,
  mannKendall,
  residualDiagnostics,
} from '../src/ai/forecast.js';

test('serie con 60 valores produce evaluación temporal y pronóstico finito', () => {
  const x = Array.from({ length: 60 }, (_, i) => 18 + i * 0.12 + Math.sin(i / 3) * 0.3);
  const r = forecast(x);
  assert.ok(Number.isFinite(r.predicted));
  assert.ok(r.trainingRows >= 10);
  assert.ok(r.testingRows >= 5);
  assert.ok(r.metrics.mae >= 0);
  assert.equal(r.method, 'holdout_temporal_80_20');
});

test('sin 30 observaciones no entrena', () => assert.throws(() => forecast(Array(20).fill(1)), /30/));

test('MAE RMSE R2 exactos', () => {
  const a = metrics([1, 2, 3], [1, 2, 3]);
  assert.equal(a.mae, 0);
  assert.equal(a.rmse, 0);
  assert.equal(a.r2, 1);
});

test('matriz 2x2', () => assert.deepEqual(solve([[2, 0], [0, 2]], [4, 6]), [2, 3]));

test('rezagos son anteriores al objetivo', () => {
  const e = makeExamples([1, 2, 3, 4]);
  assert.deepEqual(e[0], { x: [1, 1, 2, 3], y: 4 });
});

test('sMAPE acota el error relativo', () => {
  const a = metrics([10, 20], [10, 20]);
  assert.equal(a.smape, 0);
  const b = metrics([10], [0]);
  assert.equal(b.smape, 200);
});

test('pronóstico multi-paso devuelve tantos valores como pasos', () => {
  const x = Array.from({ length: 40 }, (_, i) => i + Math.sin(i) * 0.5);
  const model = fitModel(makeExamples(x));
  const path = forecastPath(model, x.slice(-3), 5);
  assert.equal(path.length, 5);
  assert.ok(path.every((v) => Number.isFinite(v)));
});

test('forecast respeta el horizonte solicitado', () => {
  const x = Array.from({ length: 60 }, (_, i) => 10 + i * 0.2);
  const r = forecast(x, { horizon: 7 });
  assert.equal(r.forecastPath.length, 7);
});

test('margen conformal es no negativo y crece con el nivel', () => {
  const res = [1, -2, 3, -0.5, 2.5, -1.5, 0.8, -3.2];
  const m90 = conformalMargin(res, 0.9);
  const m50 = conformalMargin(res, 0.5);
  assert.ok(m90 >= 0);
  assert.ok(m90 >= m50);
});

test('regularidad detecta muestreo uniforme', () => {
  const base = Date.parse('2026-01-01T00:00:00Z');
  const daily = Array.from({ length: 30 }, (_, i) => base + i * 86400000);
  const r = analyzeRegularity(daily);
  assert.equal(r.isRegular, true);
  assert.ok(r.cv < 0.05);
});

test('importancia de rezagos normalizada a 1', () => {
  const x = Array.from({ length: 50 }, (_, i) => 5 + Math.sin(i / 2) * 3 + i * 0.05);
  const imp = featureImportance(fitModel(makeExamples(x)));
  assert.equal(imp.length, 3);
  const sum = imp.reduce((a, b) => a + b.importance, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('validación walk-forward produce pliegues con métricas', () => {
  const x = Array.from({ length: 80 }, (_, i) => 20 + Math.sin(i / 4) * 2 + i * 0.03);
  const r = forecast(x, { folds: 4 });
  assert.equal(r.crossValidation.method, 'walk_forward_tscv');
  assert.ok(r.crossValidation.foldCount >= 1);
  assert.ok(r.crossValidation.aggregate.mae >= 0);
});

test('ACF detecta autocorrelación positiva en serie con tendencia', () => {
  const x = Array.from({ length: 30 }, (_, i) => i + 1);
  const { lags, values } = acf(x, 5);
  assert.equal(lags.length, 5);
  assert.ok(values[0] > 0.5);
  assert.ok(values[0] <= 1);
});

test('PACF devuelve un valor por rezago solicitado', () => {
  const x = Array.from({ length: 40 }, (_, i) => Math.sin(i / 3) + i * 0.05);
  const { values } = pacf(x, 6);
  assert.equal(values.length, 6);
  assert.ok(values.every((v) => Number.isFinite(v)));
});

test('límites de control centrados en la media', () => {
  const lim = spcLimits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(lim.center, 5.5);
  assert.ok(lim.ucl > lim.center);
  assert.ok(lim.lcl < lim.center);
  assert.ok(Math.abs(lim.ucl - lim.center - (lim.center - lim.lcl)) < 1e-9);
});

test('Mann-Kendall reconoce tendencia creciente significativa', () => {
  const x = Array.from({ length: 30 }, (_, i) => i * 0.5 + 1);
  const mk = mannKendall(x);
  assert.equal(mk.direction, 'up');
  assert.equal(mk.significant, true);
  assert.ok(mk.senSlope > 0);
});

test('Mann-Kendall reconoce tendencia decreciente', () => {
  const x = Array.from({ length: 30 }, (_, i) => 100 - i * 1.3);
  const mk = mannKendall(x);
  assert.equal(mk.direction, 'down');
  assert.ok(mk.senSlope < 0);
});

test('diagnóstico de residuos cuenta histograma y cuantiles coherentes', () => {
  const actual = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16];
  const predicted = [10.5, 11.5, 11.5, 12.5, 12.5, 13.5, 13.5, 14.5, 14.5, 15.5];
  const d = residualDiagnostics(actual, predicted);
  assert.equal(d.residuals.length, 10);
  assert.equal(d.summary.n, 10);
  assert.equal(d.qq.length, 10);
  assert.equal(
    d.histogram.reduce((a, b) => a + b.count, 0),
    10
  );
});

test('forecast expone banda por paso, holdout y diagnósticos', () => {
  const x = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 5) * 2 + i * 0.1);
  const r = forecast(x, { horizon: 4 });
  assert.equal(r.intervalPath.length, 4);
  assert.ok(r.intervalPath[3].margin >= r.intervalPath[0].margin);
  assert.equal(r.holdout.actual.length, r.holdout.predicted.length);
  assert.ok(r.residualDiagnostics.summary.n >= 5);
  assert.ok(r.autocorrelation.lags.length > 0);
});
