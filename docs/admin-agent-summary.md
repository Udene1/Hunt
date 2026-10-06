# Hunt Admin Company Summary Agent

## Purpose
Hunt stores a short, general company summary that visitors can glance at before deciding whether to inspect evidence.

The summary is not a user's investigation. Hunt collects evidence; the admin AI writes the general summary; a user's AI performs focused investigation against that user's objectives. Hunt does not call an LLM itself.

Good summaries are short (usually 2–4 sentences), evidence-informed, company-level, and under 900 characters. They should mention a few concrete things visible in Hunt evidence rather than merely saying what industry the company belongs to.

## Access boundaries

User MCP: `/api/mcp`. Used by pilot/paid users and their AI assistants. User tokens must never work on admin endpoints.

Admin MCP: `/api/admin/mcp`. Used only by the administrator's own AI agent. It requires `Authorization: Bearer <admin-token>`.

Admin HTTP API: `/api/admin/company-summary`. It uses the same admin bearer and provides GET/PUT access for agents that do not use MCP.

Admin tokens are stored only as hashes in `AdminAccessToken`. They are separate from user sessions, user MCP tokens, pilot PINs, and `HUNT_ADMIN_SECRET`.

## Admin token bootstrap

`POST /api/admin/mcp-token` requires the server-only `x-hunt-admin-secret: <HUNT_ADMIN_SECRET>` header and returns an admin bearer token once. Store the returned token securely. Do not expose either credential to users or browser code.

Revoke with `DELETE /api/admin/mcp-token` and body `{"tokenId":"..."}`.

`HUNT_ADMIN_SECRET` is only a provisioning credential. The normal MCP/API credential is the generated admin bearer token.

## Admin MCP tools

### get_company_evidence
Input: `{"company":"Flutterwave"}`

Returns company identity, the existing summary, observations, evidence URLs, timestamps, lifecycle state, and recent deterministic signals.

Always inspect evidence before writing or revising a summary. Never invent facts that are not supported by the returned evidence.

### update_company_summary
Input: `{"company":"Flutterwave","summary":"..."}`

The server verifies the admin bearer, resolves the company, records the newest observation timestamp supporting the summary, stores the prose, and increments `summaryVersion`.

The agent supplies the prose. Hunt stores it; Hunt does not generate it.

## Recommended agent workflow

1. Call `get_company_evidence`.
2. Read the evidence instead of relying on the existing summary.
3. Select 2–4 useful facts describing current company reality.
4. Prefer recent evidence while retaining durable context.
5. Mention concrete evidence categories when useful: products/API surfaces, engineering activity, security/compliance, procurement, partnerships, locations, leadership, etc.
6. Keep the result company-level.
7. Do not tailor it to a user's profession, service, target market, or sales objective.
8. Do not call something an opportunity merely because a signal exists.
9. Do not invent revenue, funding, customers, employees, market share, technology stack, or activity without evidence.
10. Call `update_company_summary`.
11. Revisit the summary when the evidence materially changes.

## Summary versus investigation

General summary: “What's going on with this company?”

Focused investigation: “Given that I sell backend/infrastructure engineering, is there evidence this company may need me?”

The first belongs to the shared company record. The second belongs to the user's AI and user-specific investigation context. Never store the second inside `generalSummary`.

## Agent-facing HTTP API

Read: `GET /api/admin/company-summary?company=Flutterwave`

Write: `PUT /api/admin/company-summary` with `{"company":"Flutterwave","summary":"Short evidence-informed general summary."}`

Both require `Authorization: Bearer <admin-token>`. Maximum summary length is 900 characters.

The HTTP API and Admin MCP write the same durable company summary fields. They are two interfaces to the same admin capability.

## Security

The public directory may expose `generalSummary` because it is intentionally public browsing information.

Admin bearer tokens, `HUNT_ADMIN_SECRET`, token hashes, provisioning, and admin evidence/write capability remain private.

A normal user MCP token must receive 401 on admin endpoints. Missing or invalid admin credentials must never fall through to user authorization.

## Architecture rule

Do not add an LLM API key or model provider to Hunt just to generate summaries.

The intended boundary is:

public reality → Hunt collectors → durable evidence/history → admin AI → general summary → public glance → user AI → focused investigation

Hunt remains the evidence and storage system; the external/admin agent supplies intelligence.