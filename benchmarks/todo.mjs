import assert from 'node:assert/strict';

export default {
  id: 'todo',
  version: 1,
  prompt: 'Build a polished to-do web app. Let me add tasks, mark them complete, filter All / Active / Completed, and delete tasks. Save tasks across page reloads. Support keyboard use and a 375px-wide mobile screen without horizontal scrolling. Make the controls clearly labeled and empty states helpful.',
  checks: [
    {
      id: 'add', weight: 20, requirement: 'Let me add tasks; support keyboard use.',
      async run({ page, baseURL }) {
        await page.goto(baseURL);
        const input = page.getByRole('textbox');
        await input.fill('Buy benchmark apples');
        await input.press('Enter');
        await page.getByText('Buy benchmark apples', { exact: true }).waitFor();
      },
    },
    {
      id: 'complete-filter', weight: 20, requirement: 'Mark tasks complete and filter All / Active / Completed.',
      async run({ page, baseURL }) {
        await page.goto(baseURL);
        await page.getByRole('textbox').fill('Finish benchmark');
        await page.getByRole('textbox').press('Enter');
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Active', exact: true }).click();
        await page.getByText('Finish benchmark', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Completed', exact: true }).click();
        await page.getByText('Finish benchmark', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'All', exact: true }).click();
        assert.equal(await page.getByRole('checkbox').isChecked(), true);
      },
    },
    {
      id: 'delete', weight: 15, requirement: 'Delete tasks.',
      async run({ page, baseURL }) {
        await page.goto(baseURL);
        await page.getByRole('textbox').fill('Remove benchmark task');
        await page.getByRole('textbox').press('Enter');
        await page.getByText('Remove benchmark task', { exact: true }).waitFor();
        await page.getByRole('button', { name: /delete|remove/i }).click();
        await page.getByText('Remove benchmark task', { exact: true }).waitFor({ state: 'hidden' });
      },
    },
    {
      id: 'persist', weight: 15, requirement: 'Save tasks across page reloads.',
      async run({ page, baseURL }) {
        await page.goto(baseURL);
        await page.getByRole('textbox').fill('Remember benchmark task');
        await page.getByRole('textbox').press('Enter');
        await page.getByText('Remember benchmark task', { exact: true }).waitFor();
        await page.reload();
        await page.getByText('Remember benchmark task', { exact: true }).waitFor();
      },
    },
    {
      id: 'mobile', weight: 10, requirement: 'Support a 375px-wide mobile screen without horizontal scrolling.',
      async run({ page, baseURL }) {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(baseURL);
        await page.getByRole('textbox').waitFor();
        await page.getByRole('textbox').fill('A long task to exercise the narrow layout and its controls');
        await page.getByRole('textbox').press('Enter');
        await page.getByRole('checkbox').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page overflows horizontally');
      },
    },
  ],
  rubric: [
    { id: 'visual-quality', weight: 10, requirement: 'A polished app: readable typography, clear hierarchy, consistent spacing, and usable mobile controls.' },
    { id: 'clarity', weight: 10, requirement: 'Clearly labeled controls and helpful empty states; verify keyboard navigation beyond task entry.' },
  ],
};
