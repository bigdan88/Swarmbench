import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from '../src/comparison.js';

const run = (builder, task, score, id) => ({ runId: id, builder,
  benchmark: { id: task, version: 1, promptHash: task, sourceHash: task, level: 1 },
  summary: { score, status: 'complete', workflowPassRate: score, criteria: [{ id: 'test', weight: 1, requirement: task }] },
});

test('comparison averages repeats within a task before averaging tasks', () => {
  const reports = [run('a', 'one', 100, '1'), run('a', 'one', 0, '2'), run('a', 'two', 100, '3'), run('b', 'one', 50, '4'), run('b', 'two', 50, '5')];
  reports[0].metrics = { buildCostUSD: 0.5 };
  const result = compareReports(reports);
  assert.equal(result.builders[0].score, 75);
  assert.equal(result.builders[0].cases[0].standardDeviation, 50);
  assert.deepEqual(result.builders[0].metrics.buildCostUSD, { total: 0.5, suppliedRuns: 1, totalRuns: 3 });
});

test('comparison refuses mismatched coverage, benchmark definitions, and duplicate runs', () => {
  assert.throws(() => compareReports([run('a', 'one', 10, '1'), run('b', 'two', 10, '2')]), /coverage/);
  const a = run('a', 'one', 10, '1'); const b = run('b', 'one', 10, '2');
  b.benchmark.sourceHash = 'changed';
  assert.throws(() => compareReports([a, b]), /definitions/);
  assert.throws(() => compareReports([a, a]), /unique/);
});

test('pending reviews stay provisional in comparisons', () => {
  const report = run('a', 'one', 80, '1'); report.summary.status = 'provisional';
  assert.equal(compareReports([report]).builders[0].status, 'provisional');
});
