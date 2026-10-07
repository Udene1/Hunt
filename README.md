# Opportunity Intelligence

A Nigerian company intelligence engine: continuously detect meaningful changes around companies and turn evidence into actionable commercial opportunities.

## Current product

The dashboard is company-first:

- Search a catalog of Nigerian companies by name, sector or domain.
- Watch a company.
- Immediately run an evidence scan.
- Keep a local watchlist until durable storage is connected.
- Store durable company, watch, observation, monitoring-run and signal records when Neon/Postgres is connected.
- Detect genuinely new observations using content/job fingerprints.
- Preserve first-seen and last-seen history instead of treating every scan as a new signal.

## Signal architecture

Jobs are an adapter, not the product.

The monitor is designed around independent signal types:

- Hiring: roles, departments and hiring velocity.
- Website / product: public website snapshots and content fingerprints.
- Technology / domain: planned adapter for domain and infrastructure changes.
- Product / API: planned adapter for public product and API changes.
- Security / compliance: planned adapter for public security and regulatory evidence.
- Funding / corporate: planned adapter for financing, acquisitions and leadership changes.
- Procurement / partnerships: planned adapter for public buying and partnership signals.

A single observation is evidence. A cluster of independent observations is what should become a strong commercial signal.

## Durable state

Prisma models now define:

- companies and canonical identity
- watchlists
- monitoring runs
- observations and fingerprints
- first-seen / last-seen state
- signal records
- evidence links and metadata

The Vercel project is connected to Neon PostgreSQL. The production deployment must receive the connected database environment before durable persistence can be verified.

The app still works without the database, but explicitly reports that durable persistence is not configured.

## Loop

Company → observe → normalize → baseline → detect change → cluster signals → model investigation → opportunity → Cashflow OS

Cashflow OS remains the commercial execution layer. Opportunity Intelligence is the sensing layer.


<!-- github-write-test -->