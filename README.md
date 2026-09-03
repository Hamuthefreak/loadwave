# LoadWaveI

A load board, pay and compliance toolkit built for **owner-operators** and small fleets — modeled on the patterns of DAT / Truckstop, with the paperwork (invoicing, fuel, IFTA) handled in the same app.

## What's inside

- **Marketing site** — homepage, role landing pages (`/carrier`, `/broker`, `/shipper`), pricing comparison, FAQ.
- **Live load board** — lane/equipment/rate search, `$ per mile` on every card, one-tap booking, list / route / compare views, auto-refresh with a "new since last sync" counter.
- **Search Trucks / Post a Truck** — the inverse marketplace; carriers advertise capacity and get booked.
- **Trust signals** — verified-carrier badges (MC / USDOT) on board cards.
- **My Loads / My Trucks** — post freight or capacity, private vs public.
- **Private Network** — gateway for trusted-partner load sharing.
- **Tools & Rates** — lane averages, market conditions, gated Pro insights.
- **Fuel & IFTA** — pump-side fuel logging; quarterly per-jurisdiction summaries compute automatically.
- **Invoicing** — GST/HST/QST-aware invoices generated from loads.
- **Fleet & Drivers** — equipment and HOS records.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + React Router |
| Backend | Fastify + TypeScript + Prisma |
| Database | PostgreSQL (PostGIS optional for route geometry) |

## Quick start

1. Install PostgreSQL, then create a database:

   ```sql
   CREATE DATABASE loadwave;
   ```

2. Create `.env` from `.env.example` and set `DATABASE_URL`.

3. Start the backend, migrate and run tests:

   ```powershell
   npm install
   npx prisma migrate dev
   npm run prisma:generate
   npm test
   npm run dev          # API on http://localhost:4000
   ```

4. Start the frontend:

   ```powershell
   cd web
   npm install
   npm run dev          # UI on http://localhost:5173
   ```

Open http://localhost:5173 and create an account (or two, to see the board — loads posted by one carrier are bookable by another).

## Structure

```
src/            Fastify API (auth, board, trucks, invoicing, ifta, fuel, eld, hos)
prisma/         Schema + migrations
tests/          Jest unit + integration tests
web/src/        React app
  pages/marketing/  public site
  pages/app/        the product (board, trucks, tools, fuel…)
```
