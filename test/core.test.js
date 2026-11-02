import test from 'node:test';
import assert from 'node:assert/strict';
import { builderPacket, validateBenchmark, summarize, reportSummary, orderedSteps } from '../src/core.js';

const benchmark = () => ({ id: 'example', version: 1, prompt: 'Make a thing', secret: 'hidden', checks: [{ id: 'works', weight: 80, requirement: 'Make a thing', run() {} }], rubric: [{ id: 'design', weight: 20, requirement: 'Make a thing' }] });

test('builder packet exports only the public prompt and identity', () => {
  assert.deepEqual(builderPacket(benchmark()), { id: 'example', version: 1, prompt: 'Make a thing' });
});
test('reject duplicate ids, unsafe ids, and invalid weights', () => {
  for (const change of [b => b.rubric[0].id = 'works', b => b.checks[0].id = '../escape', b => b.checks[0].weight = 0, b => b.checks[0].weight = NaN]) {
    const b = benchmark(); change(b);
    assert.throws(() => validateBenchmark(b));
  }
});
test('pending subjective reviews cannot inflate a score', () => {
  const b = benchmark();
  const results = [{ ...b.checks[0], status: 'passed' }];
  assert.equal(summarize(results, b.rubric).score, 80);
  assert.equal(summarize(results, b.rubric).status, 'provisional');
  assert.equal(summarize(results, b.rubric, { design: { score: 0.5, evidence: 'Small labels on mobile screenshot' } }).score, 90);
  assert.equal(summarize([{ ...results[0], status: 'failed' }], b.rubric).score, 0);
});
test('reviews require valid scores, known criteria, and evidence', () => {
  const b = benchmark();
  for (const reviews of [{ unknown: { score: 1, evidence: 'x' } }, { design: { score: 2, evidence: 'x' } }, { design: { score: 1, evidence: '' } }, { design: { score: '1', evidence: 'x' } }]) {
    assert.throws(() => summarize([], b.rubric, reviews));
  }
});
test('review input cannot change criterion weights or status', () => {
  const b = benchmark();
  const summary = summarize([{ ...b.checks[0], status: 'passed' }], b.rubric, {
    design: { score: 0, evidence: 'Unusable controls', weight: 0, status: 'pending' },
  });
  assert.equal(summary.score, 80);
  assert.equal(summary.status, 'complete');
  assert.equal(summary.totalWeight, 100);
});

test('workflow graphs reject missing dependencies, duplicates, and cycles', () => {
  const step = (id, dependsOn) => ({ id, dependsOn, weight: 1, requirement: 'Do it', run() {} });
  const b = { id: 'workflow', version: 1, prompt: 'Do it', workflows: [{ id: 'journey', steps: [step('a', ['b']), step('b', [])] }] };
  assert.deepEqual(orderedSteps(b.workflows[0]).map(item => item.id), ['b', 'a']);
  validateBenchmark(b);
  for (const steps of [[step('a', ['missing'])], [step('a', ['b']), step('b', ['a'])], [step('a', []), step('a', [])]]) {
    assert.throws(() => validateBenchmark({ ...b, workflows: [{ id: 'journey', steps }] }));
  }
  for (const change of [value => value.level = 5, value => value.workflowThreshold = 0, value => value.workflows[0].steps[0].axis = 'invented']) {
    const value = structuredClone({ ...b, workflows: [] });
    value.workflows = [{ id: 'journey', steps: [step('a', [])] }]; change(value);
    assert.throws(() => validateBenchmark(value));
  }
});

test('axis scores and workflow threshold keep blocked steps in their denominators', () => {
  const report = { benchmark: { workflowThreshold: 0.9 }, rubric: [], reviews: {},
    results: Array.from({ length: 10 }, (_, i) => ({ id: String(i), workflow: 'journey', weight: 1, axis: 'state', status: i < 9 ? 'passed' : 'blocked' })) };
  const summary = reportSummary(report);
  assert.equal(summary.score, 90);
  assert.equal(summary.axes.state.score, 90);
  assert.equal(summary.workflowPassRate, 100);
  report.results[0].status = 'failed';
  assert.equal(reportSummary(report).workflowPassRate, 0);
});

test('an unavailable app cannot receive reviewer points', () => {
  const b = benchmark();
  const summary = reportSummary({ benchmark: b, results: [{ ...b.checks[0], status: 'blocked' }], rubric: b.rubric,
    reviews: { design: { score: 1, evidence: 'Looks nice' } }, execution: { status: 'failed' } });
  assert.equal(summary.score, 0);
  assert.equal(summary.executionGated, true);
});
