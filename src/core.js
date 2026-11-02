import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');

export const AXES = ['ui', 'functionality', 'state', 'api', 'navigation', 'data'];
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);

// Old one-function checks remain valid as single-step workflows.
export function workflowsFor(benchmark) {
  return [
    ...(benchmark.checks ?? []).map(check => ({ id: check.id, steps: [check] })),
    ...(benchmark.workflows ?? []),
  ];
}

export function orderedSteps(workflow) {
  const steps = workflow.steps.map((step, index) => ({ ...step,
    dependsOn: step.dependsOn ?? (index ? [workflow.steps[index - 1].id] : []),
  }));
  const done = new Set();
  const ordered = [];
  while (ordered.length < steps.length) {
    const next = steps.find(step => !done.has(step.id) && step.dependsOn.every(id => done.has(id)));
    if (!next) throw new Error(`Cyclic or unknown step dependencies in ${workflow.id}.`);
    ordered.push(next); done.add(next.id);
  }
  return ordered;
}

export function validateBenchmark(benchmark) {
  if (!benchmark || typeof benchmark.prompt !== 'string' || !benchmark.prompt.trim()) throw new Error('A nonempty prompt is required.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(benchmark.id ?? '')) throw new Error('Benchmark id must use lowercase letters, numbers, and hyphens.');
  if (!Number.isInteger(benchmark.version) || benchmark.version < 1) throw new Error('Benchmark version must be a positive integer.');
  for (const key of ['checks', 'workflows', 'rubric']) {
    if (benchmark[key] !== undefined && !Array.isArray(benchmark[key])) throw new Error(`${key} must be an array.`);
  }
  if (benchmark.level !== undefined && (!Number.isInteger(benchmark.level) || benchmark.level < 0 || benchmark.level > 4)) throw new Error('Difficulty level must be an integer from 0 to 4.');
  if (benchmark.workflowThreshold !== undefined && (!Number.isFinite(benchmark.workflowThreshold) || benchmark.workflowThreshold <= 0 || benchmark.workflowThreshold > 1)) throw new Error('Workflow threshold must be greater than 0 and at most 1.');
  const workflowIds = new Set();
  for (const workflow of workflowsFor(benchmark)) {
    if (!slug(workflow.id) || workflowIds.has(workflow.id)) throw new Error('Workflow ids must be unique lowercase slugs.');
    workflowIds.add(workflow.id);
    if (!Array.isArray(workflow.steps) || !workflow.steps.length) throw new Error(`Workflow ${workflow.id} needs steps.`);
    const stepIds = new Set();
    for (const step of workflow.steps) {
      if (!slug(step.id) || stepIds.has(step.id)) throw new Error(`Invalid or duplicate step id in ${workflow.id}.`);
      stepIds.add(step.id);
      if (typeof step.run !== 'function') throw new Error(`Missing check function: ${step.id}`);
      if (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) || step.dependsOn.some(id => !slug(id)))) throw new Error('dependsOn must contain step ids.');
    }
    if (workflow.setup !== undefined && typeof workflow.setup !== 'function') throw new Error('Workflow setup must be a function.');
    orderedSteps(workflow);
  }
  const criteria = [...(benchmark.checks ?? []), ...(benchmark.workflows ?? []).flatMap(workflow => workflow.steps.map(step => ({ ...step, id: `${workflow.id}.${step.id}` }))), ...(benchmark.rubric ?? [])];
  if (!criteria.length) throw new Error('At least one criterion is required.');
  const ids = new Set();
  for (const criterion of criteria) {
    if (!criterion.id || ids.has(criterion.id)) throw new Error('Criterion ids must be unique.');
    ids.add(criterion.id);
    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) throw new Error(`Invalid weight: ${criterion.id}`);
    if (typeof criterion.requirement !== 'string' || !criterion.requirement.trim()) throw new Error(`Missing prompt requirement: ${criterion.id}`);
    if (criterion.axis !== undefined && !AXES.includes(criterion.axis)) throw new Error(`Unknown evaluation axis: ${criterion.axis}`);
  }
  for (const item of benchmark.rubric ?? []) {
    if (!slug(item.id)) throw new Error('Rubric ids must be lowercase slugs.');
    if (item.method !== undefined && !['screenshot', 'manual'].includes(item.method)) throw new Error('Review method must be screenshot or manual.');
  }
  return benchmark;
}

export function builderPacket(benchmark) {
  validateBenchmark(benchmark);
  // Deliberate allowlist: never serialize the evaluator's object into the packet.
  return { id: benchmark.id, version: benchmark.version, prompt: benchmark.prompt };
}

export function summarize(results, rubric, reviews = {}) {
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews)) throw new Error('Reviews must be an object keyed by criterion id.');
  const allowed = new Set(rubric.map(item => item.id));
  for (const [id, review] of Object.entries(reviews)) {
    if (!allowed.has(id)) throw new Error(`Unknown review criterion: ${id}`);
    if (!Number.isFinite(review?.score) || review.score < 0 || review.score > 1 || typeof review.evidence !== 'string' || !review.evidence.trim()) {
      throw new Error(`Review ${id} needs a score from 0 to 1 and written evidence.`);
    }
  }
  const criteria = [
    ...results.map(item => ({ ...item, score: item.status === 'passed' ? 1 : 0 })),
    ...rubric.map(item => ({ ...item, status: reviews[item.id] ? 'reviewed' : 'pending',
      ...(reviews[item.id] ? { score: reviews[item.id].score, evidence: reviews[item.id].evidence } : {}),
    })),
  ];
  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);
  const pendingWeight = criteria.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight = criteria.reduce((sum, item) => sum + item.weight * (item.score ?? 0), 0);
  const axes = {};
  for (const axis of AXES) {
    const items = criteria.filter(item => item.axis === axis);
    if (!items.length) continue;
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    axes[axis] = { score: Math.round(10000 * items.reduce((sum, item) => sum + item.weight * (item.score ?? 0), 0) / total) / 100,
      totalWeight: total, pendingWeight: items.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.weight, 0) };
  }
  return {
    status: pendingWeight ? 'provisional' : 'complete',
    // Pending reviews remain in the denominator and cannot inflate the score.
    score: Math.round(10000 * earnedWeight / totalWeight) / 100,
    earnedWeight, totalWeight, pendingWeight, criteria, axes,
  };
}

export function reportSummary(report) {
  const summary = summarize(report.results, report.rubric, report.reviews);
  // An unavailable app cannot earn points from a screenshot or manual review.
  if (report.execution?.status === 'failed') { summary.score = 0; summary.executionGated = true; }
  const groups = Map.groupBy(report.results, item => item.workflow ?? item.id);
  const workflows = [...groups].map(([id, steps]) => ({ id, passed: steps.filter(step => step.status === 'passed').length, total: steps.length }));
  for (const item of workflows) item.status = item.passed / item.total >= (report.benchmark.workflowThreshold ?? 0.9) ? 'passed' : 'failed';
  summary.workflows = workflows;
  summary.workflowPassRate = workflows.length ? 100 * workflows.filter(item => item.status === 'passed').length / workflows.length : null;
  return summary;
}

export function markdownReport(report) {
  const clean = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    `# ${report.benchmark.id} — ${report.summary.score}/100 (${report.summary.status})`,
    '', `Run: ${report.runId}`, `URL: ${report.url}`, `Prompt SHA-256: ${report.benchmark.promptHash}`,
    `Difficulty: ${report.benchmark.level === undefined ? 'unspecified' : `L${report.benchmark.level}`}`,
    `App availability: ${report.execution?.status ?? 'not recorded'}`,
    `Workflow pass rate: ${report.summary.workflowPassRate == null ? 'not recorded' : `${report.summary.workflowPassRate.toFixed(1)}%`}`,
    '', '| Criterion | Requirement | Status | Weight | Evidence |', '| --- | --- | --- | ---: | --- |',
    ...report.summary.criteria.map(item => `| ${clean(item.id)} | ${clean(item.requirement)} | ${item.status} | ${item.weight} | ${clean(item.evidence ?? item.error ?? 'Review required')} |`),
    '', `Pending review weight: ${report.summary.pendingWeight}/${report.summary.totalWeight}.`,
    '', '| Axis | Score / 100 | Pending weight |', '| --- | ---: | ---: |',
    ...Object.entries(report.summary.axes ?? {}).map(([axis, value]) => `| ${axis} | ${value.score} | ${value.pendingWeight} |`),
    'Screenshots, traces, and browser diagnostics are stored alongside report.json.', '',
  ].join('\n');
}
