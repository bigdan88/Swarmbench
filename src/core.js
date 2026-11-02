import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');

export function validateBenchmark(benchmark) {
  if (!benchmark || typeof benchmark.prompt !== 'string' || !benchmark.prompt.trim()) throw new Error('A nonempty prompt is required.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(benchmark.id ?? '')) throw new Error('Benchmark id must use lowercase letters, numbers, and hyphens.');
  if (!Number.isInteger(benchmark.version) || benchmark.version < 1) throw new Error('Benchmark version must be a positive integer.');
  const criteria = [...(benchmark.checks ?? []), ...(benchmark.rubric ?? [])];
  if (!criteria.length) throw new Error('At least one criterion is required.');
  const ids = new Set();
  for (const criterion of criteria) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(criterion.id ?? '') || ids.has(criterion.id)) throw new Error('Criterion ids must be unique lowercase slugs.');
    ids.add(criterion.id);
    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) throw new Error(`Invalid weight: ${criterion.id}`);
    if (typeof criterion.requirement !== 'string' || !criterion.requirement.trim()) throw new Error(`Missing prompt requirement: ${criterion.id}`);
  }
  for (const check of benchmark.checks ?? []) {
    if (typeof check.run !== 'function') throw new Error(`Missing check function: ${check.id}`);
  }
  return benchmark;
}

export function builderPacket(benchmark) {
  validateBenchmark(benchmark);
  // Deliberate allowlist: never serialize the evaluator's object into the packet.
  return { id: benchmark.id, version: benchmark.version, prompt: benchmark.prompt };
}

export function summarize(results, rubric, reviews = {}) {
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
  return {
    status: pendingWeight ? 'provisional' : 'complete',
    // Pending reviews remain in the denominator and cannot inflate the score.
    score: Math.round(10000 * earnedWeight / totalWeight) / 100,
    earnedWeight, totalWeight, pendingWeight, criteria,
  };
}

export function markdownReport(report) {
  const clean = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    `# ${report.benchmark.id} — ${report.summary.score}/100 (${report.summary.status})`,
    '', `Run: ${report.runId}`, `URL: ${report.url}`, `Prompt SHA-256: ${report.benchmark.promptHash}`,
    '', '| Criterion | Requirement | Status | Weight | Evidence |', '| --- | --- | --- | ---: | --- |',
    ...report.summary.criteria.map(item => `| ${clean(item.id)} | ${clean(item.requirement)} | ${item.status} | ${item.weight} | ${clean(item.evidence ?? item.error ?? 'Review required')} |`),
    '', `Pending review weight: ${report.summary.pendingWeight}/${report.summary.totalWeight}.`,
    'Screenshots, traces, and browser diagnostics are stored alongside report.json.', '',
  ].join('\n');
}
