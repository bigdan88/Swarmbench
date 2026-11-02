import assert from 'node:assert/strict';

export default {
  id: 'weather', version: 1, level: 1,
  prompt: 'Build a weather search page with a labeled City input and a Search button. Fetch GET /api/weather?city=<city> and show the returned city, temperature in Celsius, and condition. The JSON response has city (string), temperature (number), and condition (string). Show a clear error when the request fails, and let me retry successfully. A blank city must show a validation message. Make the page readable and usable on mobile.',
  workflows: [
    { id: 'search',
      async setup({ tools, state }) {
        state.api = await tools.mockApi('**/api/weather?*', { json: { city: 'Mapleford', temperature: 17, condition: 'Cloudy' } });
      },
      steps: [
        { id: 'result', axis: 'api', weight: 35, requirement: 'Search the API and display its city, Celsius temperature, and condition.',
          async run({ page, baseURL, state }) {
            await page.goto(baseURL);
            await page.getByRole('textbox', { name: /city/i }).fill('Mapleford');
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await page.getByText('Mapleford', { exact: true }).waitFor();
            await page.getByText(/17\s*°?\s*C/).waitFor();
            await page.getByText('Cloudy', { exact: true }).waitFor();
            state.api.assertUsed();
            assert.ok(state.api.calls.some(call => new URL(call.url).searchParams.get('city') === 'Mapleford'), 'Search must send the entered city to the API.');
          } },
      ] },
    { id: 'recovery',
      async setup({ tools, state }) { state.failure = await tools.breakApi('**/api/weather?*'); },
      steps: [
        { id: 'error', axis: 'api', weight: 20, requirement: 'Show a clear error when the weather request fails.',
          async run({ page, baseURL, state }) {
            await page.goto(baseURL);
            await page.getByRole('textbox', { name: /city/i }).fill('Mapleford');
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await page.getByRole('alert').waitFor();
            assert.ok((await page.getByRole('alert').innerText()).trim(), 'Error message must contain visible text.');
            state.failure.assertUsed();
          } },
        { id: 'retry', axis: 'api', weight: 15, requirement: 'Retry successfully after a failed weather request.',
          async run({ page, tools }) {
            const api = await tools.mockApi('**/api/weather?*', { json: { city: 'Mapleford', temperature: 21, condition: 'Sunny' } });
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await page.getByText(/21\s*°?\s*C/).waitFor();
            await page.getByText('Sunny', { exact: true }).waitFor();
            api.assertUsed();
          } },
      ] },
    { id: 'validation', steps: [
      { id: 'blank', axis: 'functionality', weight: 10, requirement: 'A blank city shows a validation message.',
        async run({ page, baseURL }) {
          await page.goto(baseURL);
          await page.getByRole('button', { name: 'Search', exact: true }).click();
          // Accept native constraint validation or a visible application alert.
          const invalid = await page.getByRole('textbox', { name: /city/i }).evaluate(input => !input.validity.valid);
          if (!invalid) await page.getByRole('alert').waitFor();
        } },
    ] },
  ],
  rubric: [{ id: 'readability', axis: 'ui', method: 'screenshot', weight: 20, requirement: 'Readable, clearly labeled weather page with usable mobile controls.' }],
};
