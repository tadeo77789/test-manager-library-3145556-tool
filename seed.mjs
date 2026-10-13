#!/usr/bin/env node
// Demo seeder for Manager Library. It talks to the API only (no SQL).
//
//   node seed.mjs             normal seed: catalog, members, librarian, loans, returns
//   node seed.mjs --overdue   3 loans that are overdue (run the API with CLOCK_OFFSET_DAYS=-20)
//
// Environment:
//   API_URL         default http://localhost:8000/api/v1
//   ADMIN_USERNAME  required
//   ADMIN_PASSWORD  required
//
// Re-runnable: business conflicts (409/422 with a known code) are reported and skipped.

const API_URL = (process.env.API_URL ?? 'http://localhost:8000/api/v1').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const OVERDUE_MODE = process.argv.includes('--overdue');

const COPIES_PER_BOOK = 3;
const TARGET_LOANS = 15;
const RETURNS = 5;
const LIBRARIAN = { username: 'bibliotecario.demo', password: 'Biblio2026-demo', role: 'librarian' };

// Business rule codes that mean "already done" or "not allowed right now". They are skipped, not fatal.
const EXPECTED_CONFLICTS = new Set([
  'USERNAME_TAKEN',
  'ISBN_TAKEN',
  'DOCUMENT_TAKEN',
  'BOOK_NOT_AVAILABLE',
  'MEMBER_HAS_OVERDUE',
  'MEMBER_LIMIT_EXCEEDED',
  'DUPLICATE_BOOK_IN_LOAN',
  'ITEM_ALREADY_RETURNED',
]);

// [title, author, category name]. Real titles, spread over the five categories.
const BOOKS = [
  ['Cien años de soledad', 'Gabriel García Márquez', 'Novela'],
  ['El amor en los tiempos del cólera', 'Gabriel García Márquez', 'Novela'],
  ['Crónica de una muerte anunciada', 'Gabriel García Márquez', 'Novela'],
  ['Don Quijote de la Mancha', 'Miguel de Cervantes', 'Novela'],
  ['La casa de los espíritus', 'Isabel Allende', 'Novela'],
  ['Rayuela', 'Julio Cortázar', 'Novela'],
  ['La sombra del viento', 'Carlos Ruiz Zafón', 'Novela'],
  ['Pedro Páramo', 'Juan Rulfo', 'Novela'],
  ['La tregua', 'Mario Benedetti', 'Novela'],
  ['Como agua para chocolate', 'Laura Esquivel', 'Novela'],
  ['Crimen y castigo', 'Fiódor Dostoievski', 'Novela'],
  ['Orgullo y prejuicio', 'Jane Austen', 'Novela'],
  ['Ficciones', 'Jorge Luis Borges', 'Novela'],
  ['Los de abajo', 'Mariano Azuela', 'Novela'],
  ['Breve historia del tiempo', 'Stephen Hawking', 'Ciencia'],
  ['Cosmos', 'Carl Sagan', 'Ciencia'],
  ['El gen egoísta', 'Richard Dawkins', 'Ciencia'],
  ['Sapiens: De animales a dioses', 'Yuval Noah Harari', 'Ciencia'],
  ['Una breve historia de casi todo', 'Bill Bryson', 'Ciencia'],
  ['El origen de las especies', 'Charles Darwin', 'Ciencia'],
  ['El universo elegante', 'Brian Greene', 'Ciencia'],
  ['¿Qué es la vida?', 'Erwin Schrödinger', 'Ciencia'],
  ['Código limpio', 'Robert C. Martin', 'Tecnología'],
  ['El programador pragmático', 'Andrew Hunt y David Thomas', 'Tecnología'],
  ['Patrones de diseño', 'Erich Gamma, Richard Helm, Ralph Johnson y John Vlissides', 'Tecnología'],
  ['Refactorización', 'Martin Fowler', 'Tecnología'],
  ['El mítico hombre-mes', 'Frederick P. Brooks', 'Tecnología'],
  ['Diseño de aplicaciones intensivas en datos', 'Martin Kleppmann', 'Tecnología'],
  ['Diseño guiado por el dominio', 'Eric Evans', 'Tecnología'],
  ['Inteligencia artificial: un enfoque moderno', 'Stuart Russell y Peter Norvig', 'Tecnología'],
  ['Las venas abiertas de América Latina', 'Eduardo Galeano', 'Historia'],
  ['Historia universal de la infamia', 'Jorge Luis Borges', 'Historia'],
  ['El laberinto de la soledad', 'Octavio Paz', 'Historia'],
  ['Historia de la guerra del Peloponeso', 'Tucídides', 'Historia'],
  ['El mundo de ayer', 'Stefan Zweig', 'Historia'],
  ['La conquista de América: el problema del otro', 'Tzvetan Todorov', 'Historia'],
  ['Hiroshima', 'John Hersey', 'Historia'],
  ['Memorias de Adriano', 'Marguerite Yourcenar', 'Historia'],
  ['El principito', 'Antoine de Saint-Exupéry', 'Infantil'],
  ['Charlie y la fábrica de chocolate', 'Roald Dahl', 'Infantil'],
  ['Matilda', 'Roald Dahl', 'Infantil'],
  ['Alicia en el país de las maravillas', 'Lewis Carroll', 'Infantil'],
  ['Pinocho', 'Carlo Collodi', 'Infantil'],
  ['Heidi', 'Johanna Spyri', 'Infantil'],
  ['El mago de Oz', 'L. Frank Baum', 'Infantil'],
  ['Donde viven los monstruos', 'Maurice Sendak', 'Infantil'],
  ['Pippi Calzaslargas', 'Astrid Lindgren', 'Infantil'],
  ['Peter Pan', 'J. M. Barrie', 'Infantil'],
];

const MEMBERS = [
  ['Ana María Torres', '1000000001'],
  ['Carlos Pérez Gómez', '1000000002'],
  ['Lucía Ramírez', '1000000003'],
  ['Juan David Herrera', '1000000004'],
  ['Valentina Ospina', '1000000005'],
  ['Andrés Castaño', '1000000006'],
  ['Sofía Gutiérrez', '1000000007'],
  ['Mateo Londoño', '1000000008'],
  ['Camila Restrepo', '1000000009'],
  ['Santiago Morales', '1000000010'],
];

// Members 0..6 get normal loans; members 7..9 are reserved for the overdue loans.
const NORMAL_MEMBER_COUNT = 7;
const OVERDUE_MEMBER_START = 7;
const OVERDUE_LOANS = 3;

// ISBN-13 with a valid check digit. Deterministic per index, so re-runs hit ISBN_TAKEN instead of duplicating.
function isbn13(index) {
  const body = '978842' + String(index).padStart(6, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

async function call(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function codeOf(res) {
  return res.data && typeof res.data === 'object' ? res.data.code : undefined;
}

// Unexpected failures (401, 403, 5xx, 422 VALIDATION_ERROR...) abort the run. Known business conflicts are returned.
function failUnexpected(label, res) {
  const detail = res.data && typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
  throw new Error(`${label} failed with HTTP ${res.status}: ${detail}`);
}

function listItems(data) {
  return Array.isArray(data) ? data : (data?.items ?? []);
}

async function login(username, password) {
  const res = await call('POST', '/auth/login', { body: { username, password } });
  if (res.status !== 200 || !res.data?.access_token) failUnexpected('login', res);
  return res.data.access_token;
}

async function loadCategories(token) {
  const res = await call('GET', '/categories', { token });
  if (res.status !== 200) failUnexpected('list categories', res);
  const ids = new Map(listItems(res.data).map((c) => [c.name, c.id]));
  for (const name of new Set(BOOKS.map(([, , cat]) => cat))) {
    if (!ids.has(name)) throw new Error(`Category "${name}" not found in the API`);
  }
  return ids;
}

async function ensureBook(token, index, [title, author, categoryName], categoryIds) {
  const isbn = isbn13(index + 1);
  const res = await call('POST', '/books', {
    token,
    body: {
      title,
      author,
      isbn,
      category_id: categoryIds.get(categoryName),
      total_copies: COPIES_PER_BOOK,
    },
  });
  if (res.status === 201 || res.status === 200) return res.data.id;
  if (codeOf(res) !== 'ISBN_TAKEN') failUnexpected(`create book "${title}"`, res);

  // Already seeded in a previous run: look it up by title and match the ISBN.
  const search = await call('GET', `/books?q=${encodeURIComponent(title)}&size=50`, { token });
  if (search.status !== 200) failUnexpected('search book', search);
  const found = listItems(search.data).find((b) => b.isbn === isbn);
  if (!found) throw new Error(`Book "${title}" (${isbn}) exists but could not be found`);
  return found.id;
}

async function ensureMember(token, [fullName, documentNumber]) {
  const res = await call('POST', '/members', {
    token,
    body: { full_name: fullName, document_number: documentNumber },
  });
  if (res.status === 201 || res.status === 200) return res.data.id;
  if (codeOf(res) !== 'DOCUMENT_TAKEN') failUnexpected(`create member "${fullName}"`, res);

  const search = await call('GET', `/members?q=${encodeURIComponent(fullName)}&size=50`, { token });
  if (search.status !== 200) failUnexpected('search member', search);
  const found = listItems(search.data).find((m) => m.full_name === fullName);
  if (!found) throw new Error(`Member "${fullName}" exists but could not be found`);
  return found.id;
}

// Creates a loan. Returns the loan body, or null when a business rule refuses it (logged and skipped).
async function createLoan(token, memberId, bookIds, label) {
  const res = await call('POST', '/loans', {
    token,
    body: { member_id: memberId, items: bookIds.map((book_id) => ({ book_id })) },
  });
  if (res.status === 201 || res.status === 200) return res.data;
  if (EXPECTED_CONFLICTS.has(codeOf(res))) {
    console.log(`  skip ${label}: ${codeOf(res)}`);
    return null;
  }
  return failUnexpected(label, res);
}

async function ensureCatalog(token) {
  const categoryIds = await loadCategories(token);
  const bookIds = [];
  for (let i = 0; i < BOOKS.length; i++) {
    bookIds.push(await ensureBook(token, i, BOOKS[i], categoryIds));
  }
  const memberIds = [];
  for (const member of MEMBERS) {
    memberIds.push(await ensureMember(token, member));
  }
  console.log(`Catalog ready: ${bookIds.length} books, ${memberIds.length} members.`);
  return { bookIds, memberIds };
}

async function seedOverdue(token, { bookIds, memberIds }) {
  let created = 0;
  for (let i = 0; i < OVERDUE_LOANS; i++) {
    const memberId = memberIds[OVERDUE_MEMBER_START + i];
    const loan = await createLoan(token, memberId, [bookIds[i]], `overdue loan ${i + 1}`);
    if (loan) created++;
  }
  console.log(`Overdue loans created: ${created}/${OVERDUE_LOANS}.`);
  console.log('Restart the API with CLOCK_OFFSET_DAYS=0 and run "node seed.mjs" to finish the demo data.');
}

async function seedNormal(token, { bookIds, memberIds }) {
  // Librarian (idempotent: a conflict on the username means it already exists).
  const user = await call('POST', '/users', {
    token,
    body: { username: LIBRARIAN.username, password: LIBRARIAN.password, role: LIBRARIAN.role },
  });
  if (user.status === 201 || user.status === 200) {
    console.log(`Librarian created: ${LIBRARIAN.username}`);
  } else if (codeOf(user) === 'USERNAME_TAKEN') {
    console.log(`Librarian already exists: ${LIBRARIAN.username}`);
  } else {
    failUnexpected('create librarian', user);
  }

  // Loans: one book per loan, round robin over the normal members, so no member exceeds 3 open books.
  const loans = [];
  for (let i = 0; i < TARGET_LOANS; i++) {
    const memberId = memberIds[i % NORMAL_MEMBER_COUNT];
    const bookId = bookIds[(i * 7) % bookIds.length];
    const loan = await createLoan(token, memberId, [bookId], `loan ${i + 1}`);
    if (loan) loans.push(loan);
  }
  console.log(`Loans created: ${loans.length} (target ${TARGET_LOANS}).`);

  // Returns: give back the first item of the first loans.
  let returned = 0;
  for (const loan of loans.slice(0, RETURNS)) {
    const item = loan.items[0];
    const res = await call('POST', `/loans/${loan.id}/items/${item.id}/return`, { token });
    if (res.status === 200) {
      returned++;
    } else if (EXPECTED_CONFLICTS.has(codeOf(res))) {
      console.log(`  skip return: ${codeOf(res)}`);
    } else {
      failUnexpected('return item', res);
    }
  }
  console.log(`Items returned: ${returned}.`);
}

async function main() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set');
  }
  console.log(`API: ${API_URL} (mode: ${OVERDUE_MODE ? 'overdue' : 'normal'})`);
  const token = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const catalog = await ensureCatalog(token);
  if (OVERDUE_MODE) {
    await seedOverdue(token, catalog);
  } else {
    await seedNormal(token, catalog);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(`Seeder error: ${err.message}`);
  process.exit(1);
});
