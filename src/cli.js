#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { builderPacket, hash, reportSummary, validateBenchmark } from './core.js';

const usage = `Swarmbench
  prepare <benchmark.mjs> --out <new-packet-directory>
  evaluate <benchmark.mjs> --url <app-url> --out <new-run-directory> [--builder <name>] [--revision <commit>]
  review <run-directory> --input <reviews.json>
  judge <run-directory> --model <vision-model-id>
  suite <suite.json> --out <new-suite-directory>
  compare <run-directory>... --out <new-comparison-directory>

Run the builder separately with only packet.json. Benchmark modules are trusted evaluator code.
Exit codes: 0 = success, 1 = failed browser checks, 2 = invalid input or harness error.`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, url: { type: 'string' }, input: { type: 'string' }, builder: { type: 'string' }, revision: { type: 'string' },
    model: { type: 'string' }, metrics: { type: 'string' },
  } });
  const [command, file] = positionals;
  if (!command || command === 'help') { console.log(usage); }
  else if (command === 'suite') {
    if (!file || !values.out) throw new Error('suite needs a manifest and --out.');
    const { runSuite } = await import('./suite.js');
    const result = await runSuite(file, resolve(values.out), { onProgress: message => console.log(message) });
    console.log(`Suite results: ${resolve(values.out)}`);
    if (result.harnessErrors) process.exitCode = 2;
    else if (result.failed) process.exitCode = 1;
  } else if (command === 'compare') {
    if (!file || !values.out) throw new Error('compare needs run directories and --out.');
    const { compareReports, comparisonMarkdown } = await import('./comparison.js');
    const reports = await Promise.all(positionals.slice(1).map(async path => JSON.parse(await readFile(join(resolve(path), 'report.json'), 'utf8'))));
    const comparison = compareReports(reports);
    const directory = resolve(values.out);
    await mkdir(directory, { recursive: false });
    await writeFile(join(directory, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
    await writeFile(join(directory, 'comparison.md'), comparisonMarkdown(comparison));
    console.log(`Comparison: ${join(directory, 'comparison.md')}`);
  } else if (['review', 'judge'].includes(command)) {
    if (!file) throw new Error(`${command} needs a run directory.`);
    const directory = resolve(file);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    if (command === 'review') {
      if (!values.input) throw new Error('review needs --input.');
      const reviews = JSON.parse(await readFile(resolve(values.input), 'utf8'));
      if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews)) throw new Error('Reviews must be an object.');
      report.reviews = { ...report.reviews, ...reviews };
    } else {
      const { judgeReport } = await import('./judge.js');
      const judgment = await judgeReport(report, directory, { model: values.model });
      await writeFile(join(directory, `judge-${judgment.id}.json`), JSON.stringify(judgment, null, 2) + '\n');
      report.reviews = { ...report.reviews, ...judgment.reviews };
      report.judgments = [...(report.judgments ?? []), `judge-${judgment.id}.json`];
      if (Number.isFinite(judgment.usage?.cost) && judgment.usage.cost >= 0) {
        report.metrics ??= {};
        report.metrics.judgeCostUSD = (report.metrics.judgeCostUSD ?? 0) + judgment.usage.cost;
      }
    }
    report.summary = reportSummary(report);
    report.reviewedAt = new Date().toISOString();
    const { writeReport } = await import('./runner.js');
    await writeReport(directory, report);
    console.log(`${report.summary.score}/100 (${report.summary.status})`);
  } else if (['prepare', 'evaluate'].includes(command)) {
    if (!file || !values.out) throw new Error(`${command} needs a benchmark file and --out.`);
    const path = resolve(file);
    const benchmark = validateBenchmark((await import(pathToFileURL(path).href)).default);
    const directory = resolve(values.out);
    if (command === 'prepare') {
      await mkdir(directory, { recursive: false });
      await writeFile(join(directory, 'packet.json'), JSON.stringify(builderPacket(benchmark), null, 2) + '\n');
      console.log(`Builder packet: ${join(directory, 'packet.json')}`);
    } else {
      if (!values.url) throw new Error('evaluate needs --url.');
      const { evaluate } = await import('./runner.js');
      const metrics = values.metrics ? JSON.parse(await readFile(resolve(values.metrics), 'utf8')) : {};
      const report = await evaluate(benchmark, { url: values.url, directory, sourceHash: hash(await readFile(path)), builder: values.builder, revision: values.revision, metrics });
      console.log(`${report.summary.score}/100 (${report.summary.status}) — ${join(directory, 'report.md')}`);
      if (report.execution.status === 'failed' || report.results.some(result => result.status !== 'passed')) process.exitCode = 1;
    }
  } else throw new Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
