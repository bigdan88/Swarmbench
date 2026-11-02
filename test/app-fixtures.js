// Small reference apps exercise the benchmark, not model quality.
export const welcome = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">
<header><span>Maple Garden</span></header><main><h1>Welcome, neighbors</h1><p>Join our community garden.</p></main>
<footer><a href="mailto:hello@example.test">hello@example.test</a></footer></html>`;

export const weather = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">
<h1>Weather</h1><form><label for="city">City</label><input id="city" required><button>Search</button></form><section id="result"></section>
<script>
document.querySelector('form').onsubmit = async event => {
  event.preventDefault(); const result = document.querySelector('#result'); result.replaceChildren();
  try {
    const response = await fetch('/api/weather?city=' + encodeURIComponent(document.querySelector('#city').value));
    if (!response.ok) throw new Error('Weather unavailable'); const data = await response.json();
    for (const value of [data.city, data.temperature + '°C', data.condition]) {
      const p = document.createElement('p'); p.textContent = value; result.append(p);
    }
  } catch {
    if (new URL(location.href).searchParams.get('broken') === 'error') return;
    const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = 'Weather unavailable. Please retry.'; result.append(p);
  }
};
</script></html>`;

export const catalog = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">
<header><a href="#home">Garden Shop</a><a id="cart" href="#cart">Cart (0)</a></header><main></main>
<script>
let products = []; let count = Number(localStorage.getItem('cart') || 0);
const broken = new URL(location.href).searchParams.get('broken');
function render() {
  document.querySelector('#cart').textContent = 'Cart (' + count + ')';
  const main = document.querySelector('main'); main.replaceChildren(); const product = products[0]; if (!product) return;
  if (location.hash === '#cart') {
    for (const text of [product.name, 'Quantity: ' + count, 'Total: $' + (broken === 'total' ? '0.00' : (count * product.price).toFixed(2))]) {
      const p = document.createElement('p'); p.textContent = text; main.append(p);
    }
  } else if (location.hash === '#product') {
    const p = document.createElement('p'); p.textContent = product.description;
    const add = document.createElement('button'); add.textContent = 'Add to cart';
    add.onclick = () => { count++; localStorage.setItem('cart', count); render(); }; main.append(p, add);
  } else {
    const link = document.createElement('a'); link.href = '#product'; link.textContent = product.name;
    const price = document.createElement('p'); price.textContent = '$' + product.price.toFixed(2);
    const image = document.createElement('img'); image.src = product.image; image.alt = product.name; main.append(link, price, image);
  }
}
addEventListener('hashchange', render);
fetch('/api/products').then(response => response.json()).then(data => { products = data; render(); });
</script></html>`;
