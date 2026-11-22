import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies } from '../src/ai/anomaly.js';

test('detecta un valor claramente atípico y marca el motivo', () => {
  const base = Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i / 3) * 0.2);
  const values = [...base, 999];
  const { points, summary } = detectAnomalies(values);
  assert.equal(points.length, values.length);
  assert.equal(points.at(-1).isAnomaly, true);
  assert.ok(points.at(-1).reasons.length > 0);
  assert.equal(summary.flagged, 1);
  assert.ok(summary.upperFence < 999);
});

test('serie pequeña no produce falsos positivos', () => {
  const { points, summary } = detectAnomalies([1, 2, 100]);
  assert.equal(summary.n, 3);
  assert.equal(summary.flagged, 0);
  assert.ok(points.every((p) => p.isAnomaly === false));
});

test('serie homogénea no marca anomalías', () => {
  const values = Array.from({ length: 25 }, () => 5);
  const { summary } = detectAnomalies(values);
  assert.equal(summary.flagged, 0);
});

test('valores no finitos no se marcan y no rompen el cálculo', () => {
  const values = Array.from({ length: 30 }, (_, i) => 7 + i * 0.01);
  values.push(NaN);
  const { points } = detectAnomalies(values);
  assert.equal(points.at(-1).isAnomaly, false);
});
