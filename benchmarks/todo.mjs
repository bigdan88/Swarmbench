import assert from 'node:assert/strict';

export default {
  id: 'todo', version: 2, level: 1,
  prompt: 'Build a polished to-do web app. Let me add tasks, mark them complete, filter All / Active / Completed, and delete tasks. Save tasks across page reloads. Support keyboard use and a 375px-wide mobile screen without horizontal scrolling. Make the controls clearly labeled and empty states helpful.',
  workflows: [
    { id: 'manage', steps: [
      { id: 'add', axis: 'functionality', weight: 20, requirement: 'Add a task using the keyboard.',
        async run({ page, baseURL }) {
          await page.goto(baseURL);
          await page.getByRole('textbox').fill('Finish benchmark');
          await page.getByRole('textbox').press('Enter');
          await page.getByText('Finish benchmark', { exact: true }).waitFor();
        } },
      { id: 'complete', axis: 'state', weight: 10, requirement: 'Mark a task complete.',
        async run({ page }) {
          await page.getByRole('checkbox').check();
          assert.equal(await page.getByRole('checkbox').isChecked(), true);
        } },
      { id: 'filter', axis: 'functionality', weight: 10, requirement: 'Filter All / Active / Completed.',
        async run({ page }) {
          await page.getByRole('button', { name: 'Active', exact: true }).click();
          await page.getByText('Finish benchmark', { exact: true }).waitFor({ state: 'hidden' });
          await page.getByRole('button', { name: 'Completed', exact: true }).click();
          await page.getByText('Finish benchmark', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'All', exact: true }).click();
          await page.getByText('Finish benchmark', { exact: true }).waitFor();
        } },
      { id: 'persist', axis: 'state', weight: 15, requirement: 'Save tasks and their completion state across page reloads.',
        async run({ page }) {
          await page.reload();
          await page.getByText('Finish benchmark', { exact: true }).waitFor();
          assert.equal(await page.getByRole('checkbox').isChecked(), true);
        } },
      { id: 'delete', axis: 'functionality', weight: 15, requirement: 'Delete a task.',
        async run({ page }) {
          await page.getByRole('button', { name: /delete|remove/i }).click();
          await page.getByText('Finish benchmark', { exact: true }).waitFor({ state: 'hidden' });
        } },
    ] },
    { id: 'mobile', steps: [
      { id: 'layout', axis: 'ui', weight: 10, requirement: 'Support a 375px-wide mobile screen without horizontal scrolling.',
        async run({ page, baseURL }) {
          await page.setViewportSize({ width: 375, height: 812 });
          await page.goto(baseURL);
          await page.getByRole('textbox').fill('A long task to exercise the narrow layout and its controls');
          await page.getByRole('textbox').press('Enter');
          await page.getByRole('checkbox').waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page overflows horizontally');
        } },
    ] },
  ],
  rubric: [
    { id: 'visual-quality', axis: 'ui', method: 'screenshot', weight: 10, requirement: 'A polished app: readable typography, clear hierarchy, consistent spacing, and usable mobile controls.' },
    { id: 'clarity', axis: 'functionality', method: 'manual', weight: 10, requirement: 'Clearly labeled controls and helpful empty states; verify keyboard navigation beyond task entry.' },
  ],
};
