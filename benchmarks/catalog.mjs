import assert from 'node:assert/strict';

const products = [{ id: '1', name: 'Trail Mug', price: 12.5, description: 'An enamel mug for the garden.',
  image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="green"/%3E%3C/svg%3E' }];

export default {
  id: 'catalog', version: 1, level: 2,
  prompt: 'Build a small multi-page garden shop. Fetch a product array from GET /api/products; each product has id, name, price (USD number), description, and image (URL). On the home page show each product name, price, thumbnail, and a link to its detail view. The detail view shows the full description and an Add to cart button. Keep a Cart link with its item count in the header across views. The cart view lists added products, quantities, and the correctly calculated total in USD. Cart contents must survive page refreshes. Use a clear, polished layout.',
  workflows: [{ id: 'purchase',
    async setup({ tools, state }) { state.api = await tools.mockApi('**/api/products', { json: products }); },
    steps: [
      { id: 'catalog', axis: 'api', weight: 20, requirement: 'Fetch products and display their names, prices, thumbnails, and detail links.',
        async run({ page, baseURL, state }) {
          await page.goto(baseURL);
          await page.getByRole('link', { name: /trail mug/i }).waitFor();
          await page.getByText(/\$12\.50/).waitFor();
          const image = page.getByRole('img').first();
          await image.waitFor();
          await image.evaluate(img => img.decode());
          state.api.assertUsed();
        } },
      { id: 'details', axis: 'navigation', weight: 15, requirement: 'Navigate from the catalog to a product detail view with a description.',
        async run({ page }) {
          const home = page.url();
          await page.getByRole('link', { name: /trail mug/i }).click();
          await page.getByText(products[0].description, { exact: true }).waitFor();
          assert.notEqual(page.url(), home, 'Product link did not navigate to a distinct URL.');
          await page.getByRole('link', { name: /cart.*0/i }).waitFor();
        } },
      { id: 'add', axis: 'state', weight: 15, requirement: 'Add a product to the cart and keep the header count current.',
        async run({ page }) {
          await page.getByRole('button', { name: /add to cart/i }).click();
          await page.getByRole('link', { name: /cart.*1/i }).waitFor();
          await page.getByRole('button', { name: /add to cart/i }).click();
          await page.getByRole('link', { name: /cart.*2/i }).waitFor();
        } },
      { id: 'total', axis: 'data', weight: 15, requirement: 'The cart lists the product, quantity, and correctly calculated USD total.',
        async run({ page }) {
          await page.getByRole('link', { name: /cart.*2/i }).click();
          await page.getByText('Trail Mug', { exact: true }).waitFor();
          await page.getByText(/quantity\s*:?\s*2/i).waitFor();
          await page.getByText(/total\s*:?\s*\$25\.00/i).waitFor();
        } },
      { id: 'persist', axis: 'state', weight: 15, requirement: 'Cart contents and header count survive a page refresh.',
        async run({ page }) {
          await page.reload();
          await page.getByText(/total\s*:?\s*\$25\.00/i).waitFor();
          await page.getByRole('link', { name: /cart.*2/i }).waitFor();
        } },
    ] }],
  rubric: [{ id: 'presentation', axis: 'ui', method: 'screenshot', weight: 20, requirement: 'A clear, polished shop layout with readable prices and distinct product, detail, and cart views.' }],
};
