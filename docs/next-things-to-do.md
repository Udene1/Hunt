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

## 6. Add change-focused investigation — IMPLEMENTED
- [x] Add `/api/changes` for authenticated change-focused evidence.
- [x] Add `get_company_changes` to user MCP.
- [x] Return current evidence, confirmed removals, durable clusters and recent signals.

## 7. Make signal clusters first-class — IMPLEMENTED
- [x] Persist cross-category signal intersections as durable `SignalCluster` records.
- [x] Store categories, score, supporting evidence IDs and monitoring run.
- [x] Keep jobs as one adapter, never the product itself.

## 8. Add deterministic opportunity candidates — IMPLEMENTED
- [x] Company change -> signal cluster -> deterministic relevance -> opportunity candidate.
- [x] Store evidence IDs, reason, score, status, timestamps and investigation state.
- [x] Scope candidates to the user watch + commercial profile.
- [x] External AI remains the investigator; Hunt does not make the sales decision.

## 9. Add notifications — IMPLEMENTED (in-app foundation)
- [x] Create durable user notifications for newly created opportunity candidates.
- [x] Add authenticated notification API with read acknowledgement.
- [x] Expose opportunity and notification feeds in the account UI.
- [ ] Later add MCP events/tasks, web push and email delivery.

## 10. Production hardening — IMPLEMENTED FOUNDATION / LIVE VERIFICATION PENDING
- [x] MCP request size limit.
- [x] MCP host/origin allowlists when configured.
- [x] Lightweight per-instance MCP rate limiting.
- [x] Existing bearer token revocation/expiry checks remain authoritative.
- [x] Adapter timeouts are already used on external probes.
- [x] Durable audit-event trail for MCP token lifecycle.
- [ ] Production observability/error alerting.
- [ ] Final database/index review after live migration.

## 11. Run the complete real-user product test — BLOCKED ON DEPLOYMENT QUOTA / PRODUCTION MIGRATION
- [x] Code path exists for register -> profile -> pilot -> browse -> watch -> monitor -> durable history -> MCP investigation -> admin summary -> public summary.
- [x] Opportunity and notification paths are now part of the product loop.
- [ ] Verify the complete loop against the newly deployed production build and Neon migration.
- [ ] Confirm no manual database intervention is required.
- [ ] Only after this should the product be treated as pilot-ready.

## Architecture rules
- Hunt observes public reality and preserves evidence/history.
- Jobs are an adapter, not the product.
- Evidence is the product.
- External AI investigates and interprets.
- No LLM/model API key inside Hunt.
- Cashflow OS integration remains deferred until Hunt works standalone.
