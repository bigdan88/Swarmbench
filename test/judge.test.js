import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeReport, validateJudgments } from '../src/judge.js';

const criteria = [{ id: 'layout', method: 'screenshot', requirement: 'Readable layout', weight: 10 }];
const artifacts = ['review-desktop.png'];
const decision = () => ({ id: 'layout', score: 0.5, reason: 'Labels overlap.', evidence: artifacts });

test('judge rejects fabricated evidence, invalid scores, duplicate decisions, and unknown ids', () => {
  for (const item of [{ ...decision(), evidence: ['invented.png'] }, { ...decision(), score: 2 }, { ...decision(), score: '1' }, { ...decision(), id: 'other' }, { ...decision(), evidence: [] }]) {
    assert.throws(() => validateJudgments([item], criteria, artifacts));
  }
  assert.throws(() => validateJudgments([decision(), decision()], criteria, artifacts));
  assert.deepEqual(validateJudgments([{ ...decision(), score: null, evidence: [] }], criteria, artifacts), {});
});

test('screenshot judging hides builder identity and excludes behavioral criteria', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swarmbench-judge-'));
  await writeFile(join(directory, artifacts[0]), 'transport-test-image');
  const report = { builder: 'SECRET-BUILDER', benchmark: { prompt: 'Build a page' }, reviews: {}, results: [], reviewEvidence: [{ screenshot: artifacts[0] }], rubric: [...criteria, { id: 'keyboard', method: 'manual', weight: 1, requirement: 'Keyboard behavior' }] };
  let request;
  const result = await judgeReport(report, directory, { model: 'test/vision', apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ decisions: [decision()] }) } }], usage: { cost: 0.01 } }) };
  } });
  assert.equal(result.reviews.layout.score, 0.5);
  assert.equal(JSON.stringify(request).includes('SECRET-BUILDER'), false);
  assert.equal(JSON.stringify(request).includes('Keyboard behavior'), false);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(result.usage.cost, 0.01);
  await assert.rejects(judgeReport(report, directory, { model: 'x', apiKey: '' }), /requires/);
});
