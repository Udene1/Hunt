# Hunt — Next Things To Do

This file is the working thread for Hunt after the core sensing, evidence, history, auth, MCP, and admin-summary foundations.

## 1. Finish Prisma production migration
- Complete the one-time baseline of the existing Neon `hunt` schema.
- Mark `20261006_admin_summary_and_access_tokens` as applied after the current schema is confirmed.
- Keep the permanent Vercel build as `npm run build`, which runs `prisma migrate deploy`.
- Verify future deployments use versioned migrations only.

## 2. Verify auth boundaries end-to-end
- Public browsing remains read-only.
- Free users can register/profile but cannot monitor/watch.
- Active pilot/paid users can monitor/watch and use user MCP.
- Expired/revoked credentials are rejected.
- User MCP credentials cannot access admin endpoints.
- Admin credentials work only on admin API/MCP surfaces.

## 3. Finish the admin company-summary loop
- Admin AI reads company evidence.
- Admin AI writes a short general company summary.
- Hunt stores summary metadata and evidence timestamp/version.
- Public company browsing shows the summary.
- Summary remains company-level context, not a user-specific investigation.
- Hunt does not contain an LLM/model API key.

## 4. Fix and verify automated monitoring
- Cron must derive a deduplicated company set from current user watches, while preserving any legacy global watches during migration.
- Run the daily rotating batch of five.
- Verify monitor persistence, deduplication, lifecycle/removal handling, and error isolation.

## 5. Verify user MCP with a real client
- Test `search_companies`, `get_company_evidence`, and `assess_company_relevance`.
- Verify authentication, pilot/paid entitlement, structured outputs, and historical evidence.
- Test with an actual external MCP client before claiming broad GPT/Claude compatibility.

## 6. Add change-focused investigation
- Add a `get_company_changes` capability that summarizes durable changes, prior state, current state, clusters, and evidence.

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
