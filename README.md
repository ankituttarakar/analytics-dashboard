# Analytics Dashboard

A sales analytics dashboard for Burger Town, built with React and TypeScript, a Node.js API, Neon PostgreSQL, and Apache ECharts.

## Features

- Filter by date, outlet, category, menu item, order type, and payment channel.
- View revenue, orders, product performance, outlet comparisons, and sales channels.
- Export the current filtered view as CSV.
- Sign in or create an account. Passwords use scrypt hashes and sessions use signed, HTTP-only cookies.
- Responsive desktop and mobile layouts with section navigation.
- Sales highlights are calculated directly from filtered metrics; the app does not call an AI provider.
- Compressed dashboard responses and five-minute server-side data caching.

## Stack

- Frontend: React 18, TypeScript, Vite
- API: Node.js HTTP server
- Database: Neon Serverless PostgreSQL
- Charts: Apache ECharts

## Run locally

Requirements: Node.js 22 or later and access to a Neon database that has been seeded with the dashboard aggregates.

1. Install Node dependencies and create a local environment file:

   ```powershell
   npm ci
   Copy-Item .env.example .env
   ```

2. Edit `.env` and set `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (at least 12 characters). Generate a session secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

3. Start the API and frontend together:

   ```powershell
   npm run dev
   ```

   Open the Vite URL shown in the terminal, usually `http://localhost:5173`. Sign in with the configured admin account, use the evaluator demo account, or create an account if `ALLOW_REGISTRATION=true`.

   **Evaluator demo access:** username `californiaburrito`, password `californiaburrito`. A successful sign-in with this configured demo account plays the California Burrito welcome animation; regular accounts go directly to the dashboard.

To verify the frontend and TypeScript:

```powershell
npm run typecheck
npm run build
```

`npm start` serves the production build and API on port 3001 by default. Set `PORT` to change it.

## Load or refresh data

The assessment workbook and generated aggregate are intentionally excluded from Git. To seed a new or updated database, obtain the provided `data.xlsx` workbook, then run:

```powershell
python -m pip install -r requirements.txt
npm run data:build -- "C:\path\to\data.xlsx"
npm run db:seed
```

The aggregate is written to `data/dashboard.json.gz`. Local development uses it directly when available; production reads the aggregate cubes from Neon. Keep the workbook and generated file private. `BillNo` is used locally to calculate distinct order counts and is not stored in the database or sent to the browser.

## Data definitions

Revenue is `Price × Quantity`. The assessment data contains 300,000 sale lines and 110,478 distinct orders. When category or item filters are selected, order counts include orders containing those selections; revenue per order is filtered revenue divided by those matching orders.

## Deployment and security

For Vercel, the root `api/[...route].mjs` function serves the existing Node API alongside the Vite frontend. Add `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, `ALLOW_REGISTRATION=true`, `DEMO_USERNAME=californiaburrito`, and `DEMO_PASSWORD=californiaburrito` in the Vercel project’s environment settings, then redeploy. Seed Neon before deployment; `.env` is local only and is not uploaded. The Render Blueprint is in `render.yaml`; set database and admin secrets in Render’s private environment settings. The Docker image also runs the Node API and built frontend; supply its environment with `--env-file .env`.

The app uses same-origin `/api` routes, so it does not need `VITE_AUTH_URL` or `VITE_DEMO_USERNAME`; keep database credentials, session secrets, and demo-password configuration in server-side environment variables only. For the same login experience locally and on Vercel, set the Vercel server variables above and deploy the same Git commit as the local checkout. To disable the California Burrito intro, remove the `setCaliforniaIntro(true)` call in `src/App.tsx`; to hide the hint and disable the demo-trigger check, unset `DEMO_USERNAME` and `DEMO_PASSWORD` in the server environment.

Never commit `.env`, database URLs, passwords, or private source data. `.env.example` contains sample configuration and the intentionally public demo-account defaults; use demo credentials only with the assessment dataset. GitHub Actions runs `npm audit`, typecheck, and the production build on pushes and pull requests.
