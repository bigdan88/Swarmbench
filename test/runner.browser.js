import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import benchmark from '../benchmarks/todo.mjs';
import { evaluate } from '../src/runner.js';

test('real browser produces evidence and distinguishes a broken submission', async () => {
  const html = await readFile(new URL('./fixture.html', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/broken' ? html.replace("tasks = tasks.filter(t => t !== task)", 'tasks = tasks') : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'swarmbench-'));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const good = await evaluate(benchmark, { url, directory: join(root, 'good'), sourceHash: 'fixture' });
    assert.equal(good.summary.score, 80);
    assert.equal(good.summary.status, 'provisional');
    assert.equal(good.results.length, 5);
    for (const result of good.results) {
      assert.equal(result.status, 'passed', result.error);
      await access(join(root, 'good', result.screenshot));
      await access(join(root, 'good', result.trace));
    }
    const broken = await evaluate(benchmark, { url: `${url}/broken`, directory: join(root, 'broken'), sourceHash: 'fixture' });
    assert.equal(broken.summary.score, 65);
    assert.equal(broken.results.find(item => item.id === 'delete').status, 'failed');
    await assert.rejects(evaluate(benchmark, { url, directory: join(root, 'good') }), /EEXIST/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
