import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, validateBenchmark } from './core.js';
import { evaluate } from './runner.js';
import { compareReports, comparisonMarkdown } from './comparison.js';

export async function runSuite(file, directory, { onProgress = () => {} } = {}) {
  const path = resolve(file);
  const suite = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(suite.cases) || !suite.cases.length) throw new Error('Suite needs at least one case.');
  const repetitions = suite.repetitions ?? 1;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('Repetitions must be an integer from 1 to 100.');
  // Validate everything before launching browsers or reserving output directories.
  const cases = [];
  const caseIds = new Set();
  for (const item of suite.cases) {
    const modulePath = resolve(dirname(path), item.benchmark);
    const benchmark = validateBenchmark((await import(pathToFileURL(modulePath).href)).default);
    if (caseIds.has(benchmark.id)) throw new Error('Suite benchmark ids must be unique.');
    caseIds.add(benchmark.id);
    const submissionIds = new Set();
    if (!Array.isArray(item.submissions) || !item.submissions.length) throw new Error('Case needs submissions.');
    for (const submission of item.submissions) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(submission.id ?? '') || submissionIds.has(submission.id)) throw new Error('Submission ids must be unique slugs per case.');
      if (typeof submission.builder !== 'string' || !submission.builder.trim()) throw new Error('Submission builder is required.');
      if (!['http:', 'https:'].includes(new URL(submission.url).protocol)) throw new Error('Submission URL must be HTTP(S).');
      submissionIds.add(submission.id);
    }
    cases.push({ benchmark, submissions: item.submissions, sourceHash: hash(await readFile(modulePath)) });
  }
  const builderSets = cases.map(item => JSON.stringify(item.submissions.map(submission => submission.builder).sort()));
  if (new Set(builderSets).size !== 1) throw new Error('Every suite case must have the same builder coverage.');
  await mkdir(directory, { recursive: false });
  const reports = [];
  const runs = [];
  for (const item of cases) for (const submission of item.submissions) for (let i = 0; i < repetitions; i++) {
    const name = `${item.benchmark.id}--${submission.id}--${i + 1}`;
    onProgress(`Evaluating ${name} (${submission.builder})`);
    try {
      const report = await evaluate(item.benchmark, { ...submission, sourceHash: item.sourceHash, directory: join(directory, name) });
      reports.push(report); runs.push({ directory: name, runId: report.runId, status: report.summary.status });
    } catch (error) { runs.push({ directory: name, status: 'harness-error', error: error.message }); }
    // Save progress after every attempt so partial runs remain inspectable.
    await writeFile(join(directory, 'suite.json'), JSON.stringify({ repetitions, runs }, null, 2) + '\n');
  }
  const harnessErrors = runs.some(run => run.status === 'harness-error');
  if (!harnessErrors) {
    const comparison = compareReports(reports);
    await writeFile(join(directory, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
    await writeFile(join(directory, 'comparison.md'), comparisonMarkdown(comparison));
  }
  return { runs, harnessErrors, failed: reports.some(report => report.results.some(item => item.status !== 'passed')) };
}
