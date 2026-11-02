import assert from 'node:assert/strict';

export default {
  id: 'welcome', version: 1, level: 0,
  prompt: 'Create a welcoming landing page for a community garden called Maple Garden. Include a header with the garden name, a main welcome heading and a short paragraph inviting neighbors to join, and a footer with contact email hello@example.test. Make it readable on desktop and on a 375px-wide mobile screen.',
  workflows: [{ id: 'page', steps: [
    { id: 'content', axis: 'functionality', weight: 60, requirement: 'Header, main welcome heading, invitation paragraph, and contact footer.',
      async run({ page, baseURL }) {
        await page.goto(baseURL);
        await page.getByRole('banner').getByText('Maple Garden', { exact: true }).waitFor();
        await page.getByRole('main').getByRole('heading', { name: /welcome/i }).waitFor();
        await page.getByRole('main').getByText(/join/i).waitFor();
        await page.getByRole('contentinfo').getByText('hello@example.test', { exact: true }).waitFor();
      } },
    { id: 'mobile', axis: 'ui', weight: 20, requirement: 'Readable on a 375px-wide mobile screen.',
      async run({ page }) {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.getByRole('main').getByRole('heading').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } },
  ] }],
  rubric: [{ id: 'readability', axis: 'ui', method: 'screenshot', weight: 20, requirement: 'Welcoming appearance, readable typography, and a clear hierarchy on desktop and mobile.' }],
};
