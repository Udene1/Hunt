# Hunt — Next Things To Do

This file is the working thread for Hunt after the core sensing, evidence, history, auth, MCP, and admin-summary foundations.

## 1. Finish Prisma production migration — IN PROGRESS
- [x] Add a full initial baseline migration for the existing Neon hunt schema.
- [ ] One-time production action: mark 00000000000000_init as applied.
- [ ] One-time production action: mark 20261006_admin_summary_and_access_tokens as applied.
- [x] Keep the permanent Vercel build as npm run build, which runs prisma migrate deploy.
- [ ] Verify a fresh deployment after the Vercel deployment quota resets.
- [x] Add CI validation for Prisma schema generation and TypeScript compilation.

## 2. Verify auth boundaries end-to-end — CODE READY, PRODUCTION TEST PENDING
- [x] Public browsing remains read-only.
- [x] Free users can register/profile but cannot monitor/watch.
- [x] Active pilot/paid users can monitor/watch and use user MCP.
- [x] Expired/revoked credentials are rejected by bearer auth.
- [x] User MCP credentials cannot authenticate to admin bearer endpoints.
- [x] Separate admin bearer-token store and bootstrap secret exist.
- [ ] Execute the full matrix against the deployed production API.

## 3. Finish the admin company-summary loop — IMPLEMENTED, PRODUCTION TEST PENDING
- [x] Admin AI can read company evidence through the private admin API/MCP.
- [x] Admin AI can write a short general company summary.
- [x] Hunt stores summary metadata, evidence timestamp, and version.
- [x] Public company browsing can expose the general summary.
- [x] Summary is explicitly company-level context, not a user-specific investigation.
- [x] Hunt contains no LLM/model API key.
- [ ] Execute read -> write -> public-display verification against production.

## 4. Fix and verify automated monitoring — CODE FIXED, PRODUCTION TEST PENDING
- [x] Cron now derives a deduplicated company set from UserWatch and preserves legacy Watch records during migration.
- [x] Daily rotating batch remains five companies.
- [x] Monitor persistence, deduplication, lifecycle/removal handling, and error isolation remain delegated to the existing monitor pipeline.
- [ ] Run and inspect the production cron once deployment is available.

## 5. Verify user MCP with a real client — READY FOR LIVE TEST
- [x] search_companies, get_company_evidence, and assess_company_relevance exist.
- [x] Bearer authentication and pilot/paid entitlement are enforced.
- [x] Structured JSON-safe outputs are implemented.
- [x] Historical evidence is exposed.
- [x] Added scripts/mcp-smoke.mjs for authenticated MCP protocol smoke testing.
- [ ] Run the smoke test against the deployed endpoint.
- [ ] Test with an actual external MCP client before claiming broad GPT/Claude compatibility.

## 6. Add change-focused investigation
- Add a get_company_changes capability that summarizes durable changes, prior state, current state, clusters, and evidence.

## 7. Make signal clusters first-class
- Combine independent observations into stronger intersections.
- Keep jobs as one adapter, never the product itself.
- Preserve evidence supporting every cluster.

## 8. Add deterministic opportunity candidates
- Company change -> signal cluster -> deterministic relevance -> opportunity candidate.
- Store evidence IDs, reason, relevance, status, timestamps, and investigation state.
- External AI remains the investigator; Hunt does not make the sales decision.

## 9. Add notifications
- Notify when relevant changes, clusters, or opportunity candidates appear.
- Later support MCP events/tasks, web push, email, and in-app notifications as appropriate.

## 10. Production hardening
- Rate limits and abuse protection.
- Token revocation and audit events.
- MCP host/origin validation.
- Request/payload limits.
- Adapter timeouts and retries.
- Observability and operational error reporting.
- Database/index review.

## 11. Run the complete real-user product test
- Register -> profile -> pilot -> browse -> watch -> monitor -> durable history -> MCP investigation -> admin summary -> public summary.
- Confirm the complete loop works without manual database intervention.
- Only after this should the product be treated as pilot-ready.

## Architecture rules
- Hunt observes public reality and preserves evidence/history.
- Jobs are an adapter, not the product.
- Evidence is the product.
- External AI investigates and interprets.
- No LLM/model API key inside Hunt.
- Cashflow OS integration remains deferred until Hunt works standalone.
