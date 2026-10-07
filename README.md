# Analytics Dashboard

A React + TypeScript sales analytics site with a Node.js API, Neon PostgreSQL, ECharts, authentication, CSV exports, and AI-assisted insights.

## Features

- Responsive overview for desktop and mobile, including revenue, orders, product mix, outlet and channel performance.
- Combined date, outlet, category, item, order type, and payment filters; all visualizations and KPIs use the same selection.
- CSV export of the selected KPIs, category and outlet totals, top products, and daily revenue.
- Email/password sign-in, scrypt password hashes, signed HTTP-only sessions, request throttling, and same-origin checks. Public registration is off by default.
- ECharts visualizations and server-side database access. The dashboard data endpoint requires a valid session.
- Optional OpenAI-generated insights from aggregate metrics only. With no `OPENAI_API_KEY`, factual metric-based highlights are shown instead. AI requests set `store: false`.
- Compressed API responses, a five-minute in-memory Neon snapshot cache, indexes for common dimensions, and cached insight responses.
- GitHub Actions CI, a Docker image, and a Render Blueprint for infrastructure setup.

## Stack

- Frontend: React 18, TypeScript, Vite
- Backend: Node.js HTTP server
- Database: Neon Serverless PostgreSQL
- Charts: Apache ECharts

## Local setup

You need Node.js 22+, a Neon PostgreSQL database, and the assessment workbook for the initial data load. The workbook and compressed aggregate are ignored by Git.

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Use a unique password of at least 12 characters. Generate the session secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

2. Build the aggregate from the source workbook. This keeps raw bill/order identifiers out of the database and browser:

   ```powershell
   python -m pip install pandas openpyxl
   npm run data:build -- "C:\Users\ankit\Downloads\data.xlsx"
   ```

3. Install packages, create the Neon tables, and import the aggregate cubes:

   ```powershell
   npm ci
   npm run db:seed
   ```

   The first configured admin account is created only if the database has no users. The seed script is safe to rerun; inserts use conflict protection and never import `BillNo` values.

4. Start the API and Vite together:

   ```powershell
   npm run dev
   ```

   Open the Vite URL (normally `http://localhost:5173`). Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

To validate types and create the production frontend build:

```powershell
npm run typecheck
npm run build
npm start
```

`npm start` serves the built site and API on port 3001 by default. Set `PORT` to change it.

## Data and metric definitions

The workbook contains 300,000 sale lines. `BillNo` identifies an order and is used only during local aggregation; it is never included in the exported cubes. `Price × Quantity` is revenue. Order counts are exact distinct orders, including category and item filters, using compact membership masks.

The source covers 17 June 2025 through 16 June 2026, with six outlets, seven categories, 45 menu items, three order types, and four settlement methods. Baseline totals are 110,478 orders, ₹69,480,952 revenue, and 434,448 units. Zero-priced rows are retained as recorded.

Average revenue per matching order is filtered revenue divided by orders containing the selected filters. When an item filter is selected, this is not full basket value.

The compressed aggregate is saved under `data/` for seeding, ignored by Git, and never placed in Vite's public assets. Neon stores only the aggregate cubes and dimension metadata, not source row identifiers.

## Secrets and account setup

- Never commit `.env`, Neon connection strings, admin passwords, or AI keys. `.env*` is ignored except for the safe `.env.example` template.
- `SESSION_SECRET` must be a private random value of at least 32 characters. Cookies are HTTP-only and use `Secure` when `NODE_ENV=production`.
- The first account is bootstrapped from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when `app_users` is empty. Further accounts can be created from SQL administration. Setting `ALLOW_REGISTRATION=true` enables public sign-up and should be a deliberate choice.
- `OPENAI_API_KEY` is optional. If configured, only filtered aggregate sales metrics are sent to the Responses API; no workbook rows, bill numbers, emails, or credentials are included.

## Deploy

The repo no longer publishes a static GitHub Pages site because that would bypass the Node API and login. GitHub Actions runs CI on pushes to `main`. To deploy on Render, create a Neon project, push this repository, and create the service from `render.yaml`; enter `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in Render's private environment settings (Render generates the session secret). Add `OPENAI_API_KEY` only if AI text generation is desired. Build the ignored aggregate locally and run `npm run db:seed` against the production Neon URL from a trusted machine before opening the site. Never put these secrets in GitHub Actions logs or repository files.

For container deployment:

```bash
docker build -t analytics-dashboard .
docker run --env-file .env -p 3001:3001 analytics-dashboard
```

The Docker image includes the built app and server, but not the assessment workbook or ignored aggregate.
