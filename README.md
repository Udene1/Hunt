# Opportunity Intelligence

A commercial signal engine: continuously detect meaningful changes around companies and turn evidence into actionable sales opportunities.

## Current MVP

- Search the initial company signal feed.
- Watch companies from the dashboard.
- Persist the watchlist locally in the browser.
- Run a real evidence scan against public hiring sources (Remotive and Arbeitnow).
- Normalize observations into source, category, timestamp and evidence URL.
- Generate a deterministic commercial signal before any AI investigation.

## Product thesis

General-purpose AI can research a company on demand. Opportunity Intelligence exists because it should continuously watch companies, preserve historical evidence, detect changes and surface reasons to act.

The next persistence layer is a durable database for watchlists, observations, baselines, deduplication and historical change detection. AI investigation comes after that deterministic evidence pipeline.

Cashflow OS remains the commercial execution layer; Opportunity Intelligence is the sensing layer.

## Loop

Company → observe → normalize → baseline → detect change → signal → AI investigation → opportunity → Cashflow OS
