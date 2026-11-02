import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function browserTools(page, context, directory) {
  return {
    async capture(name) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Evidence name must be a lowercase slug.');
      const artifacts = {};
      const errors = [];
      for (const [kind, extension, capture] of [
        ['screenshot', 'png', path => page.screenshot({ path, fullPage: true, timeout: 5000 })],
        ['dom', 'html', async path => writeFile(path, await page.content())],
        ['accessibility', 'yml', async path => writeFile(path, await page.locator('body').ariaSnapshot({ timeout: 5000 }))],
      ]) {
        const filename = `${name}.${extension}`;
        try { await capture(join(directory, filename)); artifacts[kind] = filename; }
        catch (error) { errors.push({ type: kind, message: error.message }); }
      }
      return { ...artifacts, errors, viewport: page.viewportSize(), url: page.url() };
    },
    async mockApi(matcher, { json, status = 200, abort = false } = {}) {
      const calls = [];
      await context.route(matcher, async route => {
        calls.push({ url: route.request().url(), method: route.request().method() });
        if (abort) await route.abort('failed');
        else await route.fulfill({ status, json });
      });
      return {
        calls,
        assertUsed() { assert.ok(calls.length > 0, 'Expected API route was never called; fixture did not exercise the integration.'); },
      };
    },
    async breakApi(matcher) { return this.mockApi(matcher, { abort: true }); },
  };
}
