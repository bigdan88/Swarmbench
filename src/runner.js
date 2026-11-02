import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { hash, reportSummary, markdownReport, validateBenchmark, workflowsFor, orderedSteps } from './core.js';
import { browserTools } from './browser-tools.js';

export async function writeReport(directory, report) {
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(directory, 'report.md'), markdownReport(report));
}

async function timedRun(run, args, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(args)),
      new Promise((_, reject) => { timer = setTimeout(() => {
        const error = new Error(`Step exceeded ${timeoutMs}ms.`);
        error.name = 'StepTimeout'; reject(error);
      }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function metadata(step, workflow, legacy) {
  return { id: legacy ? step.id : `${workflow.id}.${step.id}`, workflow: workflow.id, step: step.id,
    requirement: step.requirement, axis: step.axis, weight: step.weight, dependsOn: step.dependsOn };
}

export async function evaluate(benchmark, { url, directory, sourceHash, builder = 'unspecified', revision = 'unspecified', metrics = {}, timeoutMs = 15000 }) {
  validateBenchmark(benchmark);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Step timeout must be positive.');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Target must be an HTTP(S) URL.');
  for (const [key, value] of Object.entries(metrics)) {
    if (!['buildSeconds', 'inputTokens', 'outputTokens', 'buildCostUSD', 'judgeCostUSD'].includes(key) || !Number.isFinite(value) || value < 0) throw new Error(`Invalid build metric: ${key}`);
  }
  await mkdir(directory, { recursive: false });
  const started = performance.now();
  const browser = await chromium.launch();
  const report = {
    schemaVersion: 2, runId: crypto.randomUUID(), createdAt: new Date().toISOString(), url: target.href,
    builder, revision, metrics: { ...metrics },
    environment: { node: process.version, platform: process.platform, browser: browser.version(), viewport: { width: 1440, height: 900 } },
    benchmark: { id: benchmark.id, version: benchmark.version, level: benchmark.level, prompt: benchmark.prompt,
      promptHash: hash(benchmark.prompt), sourceHash, workflowThreshold: benchmark.workflowThreshold ?? 0.9 },
    results: [], rubric: benchmark.rubric ?? [], reviews: {}, reviewEvidence: [],
  };
  try {
    // Availability is a gate, not a substitute for a real build validation.
    const probe = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      const page = await probe.newPage();
      try {
        const response = await page.goto(target.href, { timeout: 15000, waitUntil: 'domcontentloaded' });
        if (!response?.ok()) throw new Error(`App returned HTTP ${response?.status() ?? 'no response'}.`);
        report.execution = { status: 'passed', httpStatus: response.status() };
      } catch (error) { report.execution = { status: 'failed', error: error.message }; }
    } finally { await probe.close(); }

    for (const workflow of workflowsFor(benchmark)) {
      const steps = orderedSteps(workflow);
      const legacy = (benchmark.checks ?? []).some(check => check.id === workflow.id);
      if (report.execution.status === 'failed') {
        report.results.push(...steps.map(step => ({ ...metadata(step, workflow, legacy), status: 'blocked', evidence: 'App unavailable.', diagnostics: [] })));
        continue;
      }
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        await context.tracing.start({ screenshots: true, snapshots: true });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(15000);
        const diagnostics = [];
        page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.message }));
        page.on('console', message => { if (message.type() === 'error') diagnostics.push({ type: 'console', message: message.text() }); });
        page.on('requestfailed', request => diagnostics.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText }));
        const args = { page, context, baseURL: target.href, tools: browserTools(page, context, directory), state: {} };
        // Fixture/setup errors are harness errors, never submission failures.
        if (workflow.setup) await timedRun(workflow.setup, args, timeoutMs);
        const outcomes = new Map();
        let timedOut = false;
        for (const step of steps) {
          const result = { ...metadata(step, workflow, legacy), status: 'passed', diagnostics: [] };
          const blocked = step.dependsOn.filter(id => outcomes.get(id) !== 'passed');
          if (blocked.length || timedOut) {
            result.status = 'blocked';
            result.evidence = timedOut ? 'Workflow stopped after a step timeout.' : `Prerequisites did not pass: ${blocked.join(', ')}`;
          } else {
            const stepStart = performance.now();
            const diagnosticStart = diagnostics.length;
            try {
              await timedRun(step.run, args, timeoutMs);
              result.evidence = 'Browser assertions passed.';
            } catch (error) {
              result.status = 'failed'; result.error = String(error.stack ?? error); result.evidence = error.message;
              timedOut = error.name === 'StepTimeout';
            }
            result.durationMs = Math.round(performance.now() - stepStart);
            const name = legacy ? step.id : `${workflow.id}--${step.id}`;
            Object.assign(result, await args.tools.capture(name));
            // Capture review views from an exercised app state, after workflow
            // fixtures and assertions, rather than an uninitialized probe page.
            if (!report.reviewEvidence.length) {
              const originalViewport = page.viewportSize();
              try {
                for (const [reviewName, viewport] of [['review-desktop', { width: 1440, height: 900 }], ['review-mobile', { width: 375, height: 812 }]]) {
                  await page.setViewportSize(viewport);
                  report.reviewEvidence.push(await args.tools.capture(reviewName));
                }
              } finally { await page.setViewportSize(originalViewport); }
            }
            result.diagnostics = [...diagnostics.slice(diagnosticStart), ...result.errors];
            delete result.errors;
          }
          result.trace = `${workflow.id}.zip`;
          outcomes.set(step.id, result.status); report.results.push(result);
        }
        await context.tracing.stop({ path: join(directory, `${workflow.id}.zip`) });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  report.metrics.evaluationSeconds = (performance.now() - started) / 1000;
  report.summary = reportSummary(report);
  await writeReport(directory, report);
  return report;
}
