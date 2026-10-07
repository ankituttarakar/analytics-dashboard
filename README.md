# Burger Town Business Analytics Dashboard

A responsive sales dashboard built against the supplied 300,000-line-item assessment workbook. It gives operators a filterable view of sales, order volume, product mix, outlet performance, and payment channels.

## Features

- Revenue, distinct matching orders, line items, quantity, and leading-outlet KPIs.
- Daily revenue trend, category mix, outlet comparisons, top items, order-type mix, and payment-channel revenue.
- Date, outlet, category, menu item, order type, and settlement filters. Every chart and KPI uses the same active filters.
- CSV export of the selected summary, category and outlet totals, top items, and daily trend.
- Responsive layout for desktop and mobile, loading/error/empty states, and client-side caching of the static compressed data response.
- GitHub Actions build and GitHub Pages deployment workflow.

## Dataset and definitions

The source workbook has one worksheet (`Sheet1`) and 300,000 rows. Each row is a sale line, not an order. `BillNo` identifies an order and may appear on several lines. The columns are `BillNo`, `Outlet_Name`, `Order_Datetime`, `Group`, `Order_Type`, `Item`, `Price`, `Quantity`, `Settlement`, and `Brand`.

Revenue is `Price × Quantity` for each line. Order volume counts distinct `BillNo` values, including when category or item filters are active. Average order value is the revenue from the matching line items divided by the number of matching orders; when a product filter is selected, this is revenue per order containing that product selection, not the full basket value.

The supplied data covers 17 June 2025 through 16 June 2026. It has six outlets, one brand (`Burger Town`), seven groups, 45 items, three order types, and four settlement channels. There are no missing values or duplicate rows. There are 8,611 zero-price lines, no negative prices or quantities, and quantity ranges from 1 to 4. Zero-price lines remain in the analysis and are not treated as missing because the workbook does not explain them. The dataset has 110,478 distinct orders.

Baseline from the original workbook:

| Measure | Value |
| --- | ---: |
| Line items | 300,000 |
| Distinct orders | 110,478 |
| Revenue | ₹69,480,952 |
| Quantity sold | 434,448 |
| Average revenue per order | ₹628.86 |

## Architecture and data processing

This is a static React and TypeScript application built with Vite. Recharts renders the charts; there is no database or runtime API. That keeps deployment simple and reliable for a fixed assessment dataset. A database-backed API would be preferable if the source were updated frequently, if access control were required, or if the workbook grew enough to make client-side filtering costly.

`scripts/build_data.py` reads the workbook during the data build. It produces two grouped datasets:

1. A line-item cube aggregated by day, outlet, category, item, order type, and settlement, with revenue, quantity, and line-item counts.
2. An order cube aggregated by day, outlet, order type, settlement, and compact category/item membership bit masks. The masks let the dashboard count distinct orders when product filters are selected without sending `BillNo` identifiers to the browser.

Dimension dictionaries and integer-coded tuples are serialized to `public/data/dashboard.json.gz`. This is an aggregate file, not a copy of the workbook's rows. The browser downloads and decompresses it once, then calculates each view from the pre-aggregated data. There is no repeated workbook parsing, no raw-row transfer, and no user-supplied query to inject into a database. For the supplied fixed dataset this has fewer operational parts than running a database service. The trade-off is that the client downloads the aggregate and performs filter aggregation locally; a frequently refreshed or substantially larger dataset should move these queries to an indexed server-side database.

```mermaid
flowchart LR
  X[Assessment workbook] --> E[Python ETL and validation]
  E --> C[Compressed aggregate cubes]
  C --> H[Static hosting via GitHub Pages]
  H --> B[React dashboard]
  B --> F[Filtered KPIs, charts, and CSV export]
```

The ETL groups source line rows for additive sales metrics. The distinct-order cube groups order membership by masks, so matching order counts remain exact across outlet, time, order type, settlement, category, and item combinations. The source was checked to confirm an order has consistent date, outlet, order type, and settlement values across its lines.

## Technical decisions and trade-offs

- **Vite + React + TypeScript:** a small static bundle with a familiar component model and compile-time checks. Next.js or a separate backend would add server infrastructure without a need for user-specific data or live ingestion.
- **Pre-aggregation instead of database queries:** the dashboard is read-only and the supplied data is a fixed snapshot. Aggregated cubes reduce computation and avoid parsing Excel on page load. A relational database with indexes on date and filter dimensions would be the next step for ongoing ingestion and concurrent users.
- **Static GitHub Pages deployment:** the app has no secrets or server-side configuration. GitHub Actions rebuilds the app when `main` changes. The aggregate is public, consistent with the public assessment repository and dataset.
- **Zero-priced lines:** retained as recorded. Their business meaning is unspecified, so the app does not silently remove them or label them as discounts.
- **AOV definition:** revenue per matching order uses product-filtered revenue and distinct orders containing the selected product. This is useful for filtered views but is different from full-basket value for those orders.

## Setup and run

Prerequisites: Node.js 20 or later and Python 3.10 or later with `pandas` and an Excel reader (`openpyxl`).

```bash
npm ci
npm run dev
```

Vite prints the local URL. To rebuild the committed aggregate from the assessment workbook:

```bash
python -m pip install pandas openpyxl
python scripts/build_data.py /path/to/data.xlsx
python scripts/validate_data.py /path/to/data.xlsx
npm run build
npm run typecheck
npm run preview
```

The workbook is not committed. The generated compressed aggregate is committed so a clone can build and run the application without the original Excel file. No environment variables or database setup are needed.

## Deployment

The repository includes `.github/workflows/deploy.yml`, which builds and deploys the static site to GitHub Pages on pushes to `main`. Once GitHub Pages is enabled for the repository with **GitHub Actions** as its source, the live URL is:

https://ankituttarakar.github.io/analytics-dashboard/

The URL becomes active after a successful Pages deployment. The first deployment requires Pages to be enabled in repository settings.

## Validation

The workbook was analyzed programmatically for sheet names, dimensions, data types, nulls, duplicate rows, field cardinalities, date range, and value distributions. `scripts/validate_data.py` independently reconciles line counts, revenue, quantity, zero-price rows, order counts, and seven filter cases against the source workbook, including a combined date/outlet/product/order-type/settlement selection. Validation passed: 300,000 line items, 110,478 orders, ₹69,480,952 revenue, and 434,448 units. `npm run build` and `tsc --noEmit` both pass. Browser-based visual checks and a deployed-site check require a reachable hosting session; neither was available in this workspace.

## Project structure

```text
src/                  Dashboard UI, filters, aggregation, and charts
scripts/build_data.py Workbook-to-aggregate ETL
public/data/           Compressed dashboard aggregates
.github/workflows/     Build and GitHub Pages deployment
```

## Limitations

The app represents the supplied workbook snapshot. Updating the source requires rerunning the ETL and publishing a new aggregate. There is no authentication because the dataset and repository are public. No AI-generated narrative is used; insights shown in the dashboard are computed directly from filtered figures.
