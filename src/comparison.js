import { hash } from './core.js';

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = value => Math.round(value * 100) / 100;

export function compareReports(reports) {
  if (!reports.length) throw new Error('No reports to compare.');
  const ids = new Set();
  const builders = new Map();
  const definitions = new Map();
  for (const report of reports) {
    if (!report.runId || ids.has(report.runId)) throw new Error('Reports must have unique run ids.');
    ids.add(report.runId);
    if (!Number.isFinite(report.summary?.score) || report.summary.score < 0 || report.summary.score > 100) throw new Error('Invalid report score.');
    if (typeof report.builder !== 'string' || !report.builder.trim()) throw new Error('Reports must identify the builder.');
    if (!report.benchmark?.sourceHash || !report.benchmark.promptHash) throw new Error('Reports need benchmark source and prompt fingerprints.');
    const task = report.benchmark.id;
    const definition = hash(JSON.stringify({ version: report.benchmark.version, prompt: report.benchmark.promptHash,
      source: report.benchmark.sourceHash, threshold: report.benchmark.workflowThreshold ?? 0.9,
      criteria: report.summary.criteria.map(item => ({ id: item.id, weight: item.weight, requirement: item.requirement, axis: item.axis })) }));
    if (definitions.has(task) && definitions.get(task) !== definition) throw new Error(`Benchmark definitions differ for ${task}; do not compare different prompts, versions, or rubrics.`);
    definitions.set(task, definition);
    if (!builders.has(report.builder)) builders.set(report.builder, new Map());
    const tasks = builders.get(report.builder);
    if (!tasks.has(task)) tasks.set(task, []);
    tasks.get(task).push(report);
  }
  const coverage = [...definitions.keys()].sort();
  const rows = [];
  for (const [builder, tasks] of builders) {
    if (JSON.stringify([...tasks.keys()].sort()) !== JSON.stringify(coverage)) throw new Error('Builders have different task coverage; evaluate the same tasks before comparing.');
    const cases = [...tasks].map(([id, runs]) => {
      const scores = runs.map(run => run.summary.score);
      const average = mean(scores);
      return { id, level: runs[0].benchmark.level, runs: runs.length, score: rounded(average),
        standardDeviation: rounded(Math.sqrt(mean(scores.map(score => (score - average) ** 2)))),
        workflowPassRate: runs.every(run => Number.isFinite(run.summary.workflowPassRate)) ? rounded(mean(runs.map(run => run.summary.workflowPassRate))) : null,
        status: runs.some(run => run.summary.status === 'provisional') ? 'provisional' : 'complete' };
    });
    const all = [...tasks.values()].flat();
    const metrics = {};
    for (const key of ['buildSeconds', 'inputTokens', 'outputTokens', 'buildCostUSD', 'judgeCostUSD', 'evaluationSeconds']) {
      const supplied = all.filter(run => Number.isFinite(run.metrics?.[key]));
      metrics[key] = { total: supplied.length ? supplied.reduce((sum, run) => sum + run.metrics[key], 0) : null, suppliedRuns: supplied.length, totalRuns: all.length };
    }
    const levels = {};
    for (const level of new Set(cases.map(item => item.level).filter(value => value !== undefined))) levels[`L${level}`] = rounded(mean(cases.filter(item => item.level === level).map(item => item.score)));
    rows.push({ builder, score: rounded(mean(cases.map(item => item.score))),
      status: cases.some(item => item.status === 'provisional') ? 'provisional' : 'complete', cases, levels, metrics });
  }
  return { schemaVersion: 1, scoring: 'Mean of per-task mean scores; each task has equal weight.',
    tasks: coverage, builders: rows.sort((a, b) => b.score - a.score) };
}

export function comparisonMarkdown(comparison) {
  const clean = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return ['# Swarmbench comparison', '', comparison.scoring, '', '| Builder | Score / 100 | Status | Tasks |', '| --- | ---: | --- | ---: |',
    ...comparison.builders.map(row => `| ${clean(row.builder)} | ${row.score} | ${row.status} | ${row.cases.length} |`),
    '', '| Builder | Task | Runs | Mean | Standard deviation | Workflow pass % |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...comparison.builders.flatMap(row => row.cases.map(item => `| ${clean(row.builder)} | ${item.id} | ${item.runs} | ${item.score} | ${item.standardDeviation} | ${item.workflowPassRate ?? 'unrecorded'} |`)), '',
    '', '| Builder | Build cost USD | Judge cost USD | Evaluation seconds |', '| --- | ---: | ---: | ---: |',
    ...comparison.builders.map(row => {
      const value = key => { const metric = row.metrics[key]; return metric.total === null ? 'unknown' : `${metric.total.toFixed(4)} (${metric.suppliedRuns}/${metric.totalRuns} runs)`; };
      return `| ${clean(row.builder)} | ${value('buildCostUSD')} | ${value('judgeCostUSD')} | ${value('evaluationSeconds')} |`;
    }), '',
    'Token counts and difficulty breakdowns are available in comparison.json. Missing metrics remain unknown.', '',].join('\n');
}
