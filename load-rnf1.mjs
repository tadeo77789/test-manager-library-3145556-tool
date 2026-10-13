#!/usr/bin/env node
// RNF-1 load test: with 5 000 books in the catalog, GET /books must answer in under 300 ms.
// Talks to the API only (no SQL). Zero dependencies (Node 24, native fetch).
//
//   node load-rnf1.mjs
//
// Environment:
//   API_URL         default http://localhost:8000/api/v1
//   ADMIN_USERNAME  required
//   ADMIN_PASSWORD  required
//   TARGET_BOOKS    default 5000 (total books in the catalog after the fill step)
//   CONCURRENCY     default 10 (fill step)
//   REQUESTS        default 50 (measured requests per scenario, sequential)
//
// Re-runnable: books already created hit ISBN_TAKEN (409) and are counted, not fatal.

const API_URL = (process.env.API_URL ?? 'http://localhost:8000/api/v1').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TARGET_BOOKS = Number(process.env.TARGET_BOOKS ?? 5000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const REQUESTS = Number(process.env.REQUESTS ?? 50);
const LIMIT_MS = 300;
const ISBN_BASE = 500000; // far from the demo seeder indexes

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD.');
  process.exit(1);
}

function isbn13(index) {
  const body = '978842' + String(index).padStart(6, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const WORDS = ['Mar', 'Sol', 'Luna', 'Río', 'Viento', 'Fuego', 'Tierra', 'Noche', 'Camino', 'Bosque', 'Ciudad', 'Isla'];

async function main() {
  const login = await call('POST', '/auth/login', { body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: HTTP ${login.status}`);
  const token = login.data.access_token;

  const cats = await call('GET', '/categories', { token });
  const categoryIds = (Array.isArray(cats.data) ? cats.data : cats.data.items).map((c) => c.id);

  const count = async () => (await call('GET', '/books?page=1&size=1', { token })).data.total;
  const before = await count();
  console.log(`API: ${API_URL}\nBooks before: ${before} (target ${TARGET_BOOKS})`);

  // Fill step: create deterministic books until the catalog reaches the target.
  let created = 0, taken = 0, failed = 0, next = 0;
  const needed = Math.max(0, TARGET_BOOKS - before);
  const t0 = performance.now();
  async function worker() {
    while (created < needed) {
      const i = next++;
      const title = `Carga ${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${i}`;
      const res = await call('POST', '/books', {
        token,
        body: { title, author: `Autor ${i % 250}`, isbn: isbn13(ISBN_BASE + i), category_id: categoryIds[i % categoryIds.length], total_copies: 3 },
      });
      if (res.status === 201 || res.status === 200) created++;
      else if (res.status === 409) taken++;
      else if (++failed > 20) throw new Error(`too many failures, last: HTTP ${res.status} ${JSON.stringify(res.data)}`);
    }
  }
  if (needed > 0) await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const total = await count();
  console.log(`Fill: created ${created}, 409 skipped ${taken}, failed ${failed} in ${((performance.now() - t0) / 1000).toFixed(1)} s. Total books now: ${total}`);

  // Measure step.
  const scenarios = [
    ['q (title search)', () => `/books?q=${encodeURIComponent('Carga Luna')}&page=1&size=10`],
    ['category_id', (n) => `/books?category_id=${categoryIds[n % categoryIds.length]}&page=1&size=10`],
    ['plain', () => '/books?page=1&size=10'],
  ];
  let allPass = total >= TARGET_BOOKS;
  console.log(`\n${REQUESTS} sequential requests per scenario, target < ${LIMIT_MS} ms (p95)`);
  console.log('scenario'.padEnd(20) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + '  result');
  for (const [name, path] of scenarios) {
    await call('GET', path(0), { token }); // warm-up, not measured
    const times = [];
    for (let n = 0; n < REQUESTS; n++) {
      const s = performance.now();
      const res = await call('GET', path(n), { token });
      times.push(performance.now() - s);
      if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status}`);
    }
    times.sort((a, b) => a - b);
    const [p50, p95, max] = [percentile(times, 50), percentile(times, 95), times[times.length - 1]];
    const pass = p95 < LIMIT_MS;
    allPass &&= pass;
    console.log(name.padEnd(20) + p50.toFixed(1).padStart(8) + p95.toFixed(1).padStart(8) + max.toFixed(1).padStart(8) + `  ${pass ? 'PASS' : 'FAIL'}`);
  }
  console.log(`\nRNF-1 (${total} books): ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 2);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
