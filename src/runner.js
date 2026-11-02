import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { hash, summarize, markdownReport } from './core.js';

export async function writeReport(directory, report) {
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(directory, 'report.md'), markdownReport(report));
}

export async function evaluate(benchmark, { url, directory, sourceHash, builder = 'unspecified', revision = 'unspecified' }) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Target must be an HTTP(S) URL.');
  // Exclusive directory creation prevents accidental evidence replacement.
  await mkdir(directory, { recursive: false });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const check of benchmark.checks ?? []) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(15000);
      const diagnostics = [];
      page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.message }));
      page.on('console', message => { if (message.type() === 'error') diagnostics.push({ type: 'console', message: message.text() }); });
      page.on('requestfailed', request => diagnostics.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText }));
      const result = { id: check.id, requirement: check.requirement, weight: check.weight, status: 'passed', diagnostics };
      try {
        await check.run({ page, context, baseURL: target.href });
        result.evidence = 'Browser assertions passed.';
      } catch (error) {
        result.status = 'failed';
        result.error = String(error.stack ?? error);
        result.evidence = error.message;
      } finally {
        result.screenshot = `${check.id}.png`;
        try { await page.screenshot({ path: join(directory, result.screenshot), fullPage: true, timeout: 5000 }); }
        catch (error) { diagnostics.push({ type: 'screenshot', message: error.message }); delete result.screenshot; }
        result.trace = `${check.id}.zip`;
        await context.tracing.stop({ path: join(directory, result.trace) });
        await context.close();
      }
      results.push(result);
    }
  } finally {
    await browser.close();
  }
  const report = {
    schemaVersion: 1, runId: crypto.randomUUID(), createdAt: new Date().toISOString(), url: target.href,
    builder, revision,
    environment: { node: process.version, platform: process.platform, browser: browser.version(), viewport: { width: 1440, height: 900 } },
    benchmark: { id: benchmark.id, version: benchmark.version, prompt: benchmark.prompt, promptHash: hash(benchmark.prompt), sourceHash },
    results, rubric: benchmark.rubric ?? [], reviews: {},
    summary: summarize(results, benchmark.rubric ?? []),
  };
  await writeReport(directory, report);
  return report;
}
