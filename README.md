# test-manager-library-3145556-tool

> **Prueba técnica · Ficha ADSO 3145556**
> Entrega: **martes 13 de octubre de 2026, a las 5:00 p. m.** (17:00, hora Colombia).

Este repositorio guarda las **utilidades** de *Manager Library*: el sembrador de datos de demostración, que usa la API. **Empieza vacío a propósito**: se construye en el fork de cada aprendiz.

## Instrucciones

Cada aprendiz debe **crear el fork** de los seis repositorios del proyecto y **resolver el proyecto
con el spec planteado**.

1. Hacer fork, a su cuenta de GitHub, de cada repositorio de la tabla del final.
2. Leer el spec en [`test-manager-library-3145556-docs`](https://github.com/code-sena/test-manager-library-3145556-docs).
   Se entrega en dos versiones: `spec-python/` y `spec-.net/`.
3. Desarrollar en los forks.

## El reto se desarrolla con React y PHP (Laravel)

El spec está escrito para Python y para .NET, pero el reto **no** se hace en esos lenguajes:

| Capa | Tecnología del reto |
|---|---|
| Frontend | React |
| Backend | PHP con Laravel |

Lo que el spec define sobre el negocio —historias, criterios de aceptación, reglas, contrato de la
API, modelo de datos— se respeta. Lo que define sobre la tecnología se traduce a React y Laravel.

## La prueba no consiste en escribir el código

El propósito principal es ver la **capacidad de desempeño con SDD** (*Spec-Driven Development*,
desarrollo guiado por especificación): cómo se lee, se interpreta y se aplica una especificación
para llevarla a un stack distinto. El código es el medio, no el fin.

## Entrega

Cuenta lo que quede **subido a los forks antes de las 5:00 p. m.** (17:00). Lo que llegue después no se revisa.
No hay prórroga: suban avances parciales con commits pequeños durante la prueba.

## Los seis repositorios

| Repositorio | Qué va ahí |
|---|---|
| [`test-manager-library-3145556-docs`](https://github.com/code-sena/test-manager-library-3145556-docs) | El spec: `spec-python/` y `spec-.net/` |
| [`test-manager-library-3145556-api`](https://github.com/code-sena/test-manager-library-3145556-api) | Backend en PHP (Laravel) |
| [`test-manager-library-3145556-app`](https://github.com/code-sena/test-manager-library-3145556-app) | Frontend en React |
| [`test-manager-library-3145556-page`](https://github.com/code-sena/test-manager-library-3145556-page) | Sitio público estático de presentación |
| [`test-manager-library-3145556-infra`](https://github.com/code-sena/test-manager-library-3145556-infra) | Contenedores, red, volúmenes y motor de base de datos vacío |
| [`test-manager-library-3145556-tool`](https://github.com/code-sena/test-manager-library-3145556-tool) | Utilidades: sembrador de datos de demostración |

---

## Demo seeder (`seed.mjs`)

Loads demonstration data **through the API only** (no SQL). It has **zero dependencies**: it needs Node 24 (native `fetch`).

| Variable | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:8000/api/v1` | API base URL |
| `ADMIN_USERNAME` | (required) | Admin user configured in the API environment |
| `ADMIN_PASSWORD` | (required) | Admin password configured in the API environment |

```bash
export ADMIN_USERNAME=admin ADMIN_PASSWORD=...   # PowerShell: $env:ADMIN_USERNAME="admin"
node seed.mjs
```

What it creates:

- 48 books with 13-digit ISBNs (valid check digit), spread over the five categories, 3 copies each.
- 10 members.
- 1 librarian (`bibliotecario.demo`).
- 15 loans (one book each, no member above 3 open books) and 5 returned items.

The seeder is re-runnable: business conflicts (`ISBN_TAKEN`, `DOCUMENT_TAKEN`, `USERNAME_TAKEN`, `MEMBER_HAS_OVERDUE`, `BOOK_NOT_AVAILABLE`, ...) are reported and skipped. Other errors stop the run.

### Overdue loans

The API sets `loaned_at` to the current time, plus the `CLOCK_OFFSET_DAYS` offset. Loans are due 14 days after `loaned_at`, so a loan created with an offset of `-20` is already overdue in real time.

1. Start the API with `CLOCK_OFFSET_DAYS=-20`.
2. Run `node seed.mjs --overdue`. This creates 3 loans that become overdue.
3. Restart the API with `CLOCK_OFFSET_DAYS=0`.
4. Run `node seed.mjs`. This completes the demo data.

After step 4, `GET /loans/overdue` returns the 3 overdue lines.

## Status

| Task | Status | Evidence |
|---|---|---|
| T-21 demo seeder through the API (>= 40 books, 10 members, >= 15 loans, 3 overdue) | Done | Run against the real API (13-oct, ~15:00): `node seed.mjs` → 48 books, 10 members, 1 librarian, 15 loans, 5 items returned. Overdue flow (`CLOCK_OFFSET_DAYS=-20`, `node seed.mjs --overdue`, back to 0) → `GET /loans/overdue` returns 3 lines (`days_late` 7); the most-borrowed report has rows. RNF-1 load test not run. |
