#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { builderPacket, hash, summarize, validateBenchmark } from './core.js';

const usage = `Swarmbench
  prepare <benchmark.mjs> --out <new-packet-directory>
  evaluate <benchmark.mjs> --url <app-url> --out <new-run-directory> [--builder <name>] [--revision <commit>]
  review <run-directory> --input <reviews.json>

Run the builder separately with only packet.json. Benchmark modules are trusted evaluator code.
Exit codes: 0 = success, 1 = failed browser checks, 2 = invalid input or harness error.`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, url: { type: 'string' }, input: { type: 'string' }, builder: { type: 'string' }, revision: { type: 'string' },
  } });
  const [command, file] = positionals;
  if (!command || command === 'help') { console.log(usage); }
  else if (command === 'review') {
    if (!file || !values.input) throw new Error('review needs a run directory and --input.');
    const directory = resolve(file);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    const reviews = JSON.parse(await readFile(resolve(values.input), 'utf8'));
    report.reviews = { ...report.reviews, ...reviews };
    report.summary = summarize(report.results, report.rubric, report.reviews);
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
      const report = await evaluate(benchmark, { url: values.url, directory, sourceHash: hash(await readFile(path)), builder: values.builder, revision: values.revision });
      console.log(`${report.summary.score}/100 (${report.summary.status}) — ${join(directory, 'report.md')}`);
      if (report.results.some(result => result.status === 'failed')) process.exitCode = 1;
    }
  } else throw new Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
