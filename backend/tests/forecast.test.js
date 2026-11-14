import test from 'node:test';import assert from 'node:assert/strict';import {forecast,metrics,makeExamples,solve} from '../src/ai/forecast.js';
test('serie con 60 valores produce evaluación temporal y pronóstico finito',()=>{const x=Array.from({length:60},(_,i)=>18+i*.12+Math.sin(i/3)*.3),r=forecast(x);assert.ok(Number.isFinite(r.predicted));assert.ok(r.trainingRows>=10);assert.ok(r.testingRows>=5);assert.ok(r.metrics.mae>=0);assert.equal(r.method,'holdout_temporal_80_20');});
test('sin 30 observaciones no entrena',()=>assert.throws(()=>forecast(Array(20).fill(1)),/30/));
test('MAE RMSE R2 exactos',()=>{const a=metrics([1,2,3],[1,2,3]);assert.equal(a.mae,0);assert.equal(a.rmse,0);assert.equal(a.r2,1);});
test('matriz 2x2',()=>assert.deepEqual(solve([[2,0],[0,2]],[4,6]),[2,3]));
test('rezagos son anteriores al objetivo',()=>{const e=makeExamples([1,2,3,4]);assert.deepEqual(e[0],{x:[1,1,2,3],y:4});});
