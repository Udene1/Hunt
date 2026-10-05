# Opportunity Intelligence

A commercial signal engine: continuously detect meaningful changes around companies and turn evidence into actionable sales opportunities.

## Current MVP

- Search the initial company signal feed.
- Watch companies from the dashboard.
- Keep the watchlist locally while durable storage is being wired.
- Run a real evidence scan against public hiring sources (Remotive and Arbeitnow).
- Run an official-website observation for known company domains.
- Normalize observations into a generic signal shape: source, type, category, timestamp, URL and fingerprint.
- Combine observations across signal categories into a deterministic multi-signal score.
- Preserve fingerprints so durable persistence can later distinguish a new observation from a changed observation.

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

## Persistence boundary

The current deployment deliberately does not pretend local state is durable. The API returns normalized observations and fingerprints, but the Vercel project currently has no database connection.

The next infrastructure step is a durable database for:

- companies and canonical identity
- watchlists
- observations and fingerprints
- first-seen / last-seen state
- baselines and change events
- signal clusters and evidence links
- suppression / tombstones
- monitoring runs and errors

Only after this historical layer exists should model investigation turn clusters into higher-level opportunities.

Cashflow OS remains the commercial execution layer; Opportunity Intelligence is the sensing layer.

## Loop

Company → observe → normalize → baseline → detect change → cluster signals → model investigation → opportunity → Cashflow OS
