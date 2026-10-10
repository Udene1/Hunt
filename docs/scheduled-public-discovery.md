# Scheduled public discovery

## Purpose

Hunt has a public-discovery route in addition to the existing watched-company monitor. To stay within the current one-cron limit, only watched-company monitoring is scheduled; public discovery is triggered manually from the authenticated admin console.

- `/api/cron/monitor` monitors a rotating batch of up to five already-watched companies.
- `/api/cron/discover` searches broad public-web topics independently of the watch list and stores the resulting candidates durably. The admin console invokes it through `POST /api/admin/discovery` with `{ "kind": "discovery" }`; the same endpoint supports `{ "kind": "monitor" }` to trigger watched-company monitoring.

Both underlying routes require `Authorization: Bearer <CRON_SECRET>`. The admin trigger requires a valid Hunt admin session and adds the cron secret server-side; it never sends the secret to the browser. The scheduled monitor uses Vercel Cron.

## Discovery topics

The first pass searches public web results for:
- company expansion and facilities;
- procurement and contract awards;
- investment and acquisitions;
- supplier, customer and partnership relationships;
- regulator and compliance references;
- financial reporting;
- operations, manufacturing and logistics.

The route reports counts and per-topic errors in its JSON response. It stores candidates in the existing `AdminReviewTask` table using `type = public_discovery_candidate`, avoiding a new database migration while the existing migration history is under investigation.

## Entity association rules

A candidate is attached to a company only when the company's name appears in the search-result title and the source URL is reachable. If the match is a curated canonical catalogue entry without a database row, Hunt creates that known company row first. The observation is explicitly marked as candidate evidence with `verificationStatus = reachable_unverified`; reachability is not claim verification.

Unresolved candidates are stored for review with their source URL, topic, search query, first/last seen metadata, and verification status. **This first pass deliberately does not create a company from a search-result title alone.** That would risk polluting the catalogue with publishers, project names, subsidiaries, or false name matches. A later entity-resolution stage should create new company records only when it can establish a sufficiently reliable company identity from stronger evidence such as a legal registry record or a verified official domain.

## Limitations

- This is scheduled search-result discovery, not a complete internet crawler or a guarantee of coverage.
- The search provider may rate-limit, change markup, or return irrelevant results. Failures are returned per topic.
- Search-result candidates are leads to inspect, not verified claims.
- Manual public discovery works only on a deployment containing the admin trigger and discovery route. The scheduled monitor requires a successful production deployment for its cron registration; preview deployments do not prove the production schedule is active.
- On the Hobby plan, runtime logs are retained for only one hour. Durable run records should be added in a future schema change so operators can inspect historical cron executions independently of Vercel's short log retention.
