import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate } from '../src/runner.js';
import { runSuite } from '../src/suite.js';
import welcomeBenchmark from '../benchmarks/welcome.mjs';
import weatherBenchmark from '../benchmarks/weather.mjs';
import catalogBenchmark from '../benchmarks/catalog.mjs';
import { welcome, weather, catalog } from './app-fixtures.js';

async function environment(run) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url.startsWith('/unavailable')) { response.writeHead(503); response.end('Unavailable'); return; }
    response.end(request.url.startsWith('/weather') ? weather : request.url.startsWith('/catalog') ? catalog : welcome);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'swarmbench-workflow-'));
  try { await run({ root, url: `http://127.0.0.1:${server.address().port}` }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('AppBench-style API fixtures test actual integration, errors, and recovery', async () => environment(async ({ root, url }) => {
  const good = await evaluate(weatherBenchmark, { url: `${url}/weather`, directory: join(root, 'weather'), sourceHash: 'weather' });
  assert.equal(good.summary.score, 80, JSON.stringify(good.results));
  assert.equal(good.summary.workflowPassRate, 100);
  const broken = await evaluate(weatherBenchmark, { url: `${url}/weather?broken=error`, directory: join(root, 'weather-broken'), sourceHash: 'weather' });
  assert.equal(broken.summary.score, 45);
  assert.equal(broken.results.find(item => item.id === 'recovery.retry').status, 'blocked');
}));

test('multi-page state, API data, and cart arithmetic are measured separately', async () => environment(async ({ root, url }) => {
  const good = await evaluate(catalogBenchmark, { url: `${url}/catalog`, directory: join(root, 'catalog'), sourceHash: 'catalog' });
  assert.equal(good.summary.score, 80, JSON.stringify(good.results));
  assert.equal(good.summary.axes.navigation.score, 100);
  assert.equal(good.summary.axes.data.score, 100);
  const broken = await evaluate(catalogBenchmark, { url: `${url}/catalog?broken=total`, directory: join(root, 'catalog-broken'), sourceHash: 'catalog' });
  assert.equal(broken.summary.score, 50);
  assert.equal(broken.results.find(item => item.id === 'purchase.persist').status, 'blocked');
}));

test('dependency failures preserve partial credit and allow independent branches', async () => environment(async ({ root, url }) => {
  let dependentRuns = 0;
  const step = (id, run, dependsOn) => ({ id, weight: 25, requirement: 'Test user flow', run, dependsOn });
  const benchmark = { id: 'graph', version: 1, prompt: 'Test user flow', workflows: [{ id: 'journey', steps: [
    step('open', async ({ page, baseURL }) => page.goto(baseURL)),
    step('fail', async () => { throw new Error('Missing feature'); }),
    step('dependent', async () => { dependentRuns++; }),
    step('independent', async ({ page }) => page.getByRole('heading').waitFor(), []),
  ] }] };
  const report = await evaluate(benchmark, { url, directory: join(root, 'graph') });
  assert.deepEqual(report.results.map(item => item.status), ['passed', 'failed', 'blocked', 'passed']);
  assert.equal(report.summary.score, 50);
  assert.equal(dependentRuns, 0);
}));

test('step deadlines stop a workflow and unavailable apps are gated', async () => environment(async ({ root, url }) => {
  const item = (id, run) => ({ id, weight: 1, requirement: 'A usable page', run });
  const benchmark = { id: 'deadline', version: 1, prompt: 'A usable page', workflows: [
    { id: 'stuck', steps: [item('never', () => new Promise(() => {})), { ...item('later', () => { throw new Error('Must not run'); }), dependsOn: [] }] },
    { id: 'separate', steps: [item('works', async ({ page, baseURL }) => page.goto(baseURL))] },
  ] };
  const report = await evaluate(benchmark, { url, directory: join(root, 'deadline'), timeoutMs: 500 });
  assert.deepEqual(report.results.map(item => item.status), ['failed', 'blocked', 'passed']);
  assert.equal(report.summary.score, 33.33);
  const unavailable = await evaluate(welcomeBenchmark, { url: `${url}/unavailable`, directory: join(root, 'unavailable') });
  assert.equal(unavailable.execution.status, 'failed');
  assert.equal(unavailable.summary.score, 0);
  assert.equal(unavailable.summary.executionGated, true);
  assert.ok(unavailable.results.every(item => item.status === 'blocked'));
}));

test('suite repetitions, comparison CLI, manual review, and public export work together', async () => environment(async ({ root, url }) => {
  const modulePath = join(root, 'simple.mjs');
  await writeFile(modulePath, `export default {id:'simple',version:1,prompt:'Show a welcome heading',checks:[{id:'heading',weight:100,requirement:'Welcome heading',async run({page,baseURL}){await page.goto(baseURL);await page.getByRole('heading',{name:/welcome/i}).waitFor();}}]};`);
  const suitePath = join(root, 'input.json');
  await writeFile(suitePath, JSON.stringify({ repetitions: 2, cases: [{ benchmark: modulePath, submissions: [
    { id: 'good', builder: 'good', url }, { id: 'bad', builder: 'bad', url: `${url}/unavailable` },
  ] }] }));
  const directory = join(root, 'suite');
  const result = await runSuite(suitePath, directory);
  assert.equal(result.runs.length, 4);
  assert.equal(result.failed, true);
  assert.equal(result.harnessErrors, false);
  const comparison = JSON.parse(await readFile(join(directory, 'comparison.json'), 'utf8'));
  assert.deepEqual(comparison.builders.map(row => row.score), [100, 0]);
  const cli = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8', timeout: 15000 });
  const compare = cli('compare', join(directory, 'simple--good--1'), join(directory, 'simple--bad--1'), '--out', join(root, 'comparison'));
  assert.equal(compare.status, 0, compare.stderr);
  const run = await evaluate(welcomeBenchmark, { url, directory: join(root, 'welcome') });
  assert.equal(run.summary.score, 80);
  const reviews = join(root, 'reviews.json');
  await writeFile(reviews, JSON.stringify({ readability: { score: 0.5, evidence: 'review-mobile.png: small text' } }));
  const review = cli('review', join(root, 'welcome'), '--input', reviews);
  assert.equal(review.status, 0, review.stderr);
  const reviewed = JSON.parse(await readFile(join(root, 'welcome', 'report.json'), 'utf8'));
  assert.equal(reviewed.summary.score, 90);
  assert.equal(reviewed.summary.status, 'complete');
  const packet = cli('prepare', 'benchmarks/weather.mjs', '--out', join(root, 'packet'));
  assert.equal(packet.status, 0, packet.stderr);
  const exported = JSON.parse(await readFile(join(root, 'packet', 'packet.json'), 'utf8'));
  assert.deepEqual(Object.keys(exported), ['id', 'version', 'prompt']);
}));
