# Hunt financial document extraction and admin review

Hunt treats financial documents as evidence, not as data to guess.

## Pipeline

1. The company scan discovers an official annual report, financial statement, results or investor PDF.
2. Hunt preserves the original `sourceUrl`.
3. PDF text is extracted page-by-page when possible.
4. Hunt attempts the configured headline metrics: revenue, net profit, gross profit, assets, liabilities, cash, debt, equity, capex, currency and period.
5. Every extracted metric keeps page-level evidence in `metrics.metricEvidence`.
6. Missing values remain missing. Hunt never converts an extraction failure into zero.
7. A scanned, malformed, oversized or otherwise ambiguous PDF creates an `AdminReviewTask`.
8. The original document URL is retained for administrator inspection.
9. Public company profile APIs expose only records with `verificationStatus=verified`.
10. Admin MCP and the admin HTTP API can inspect and resolve review tasks.

## Admin interfaces

Admin MCP: `/api/admin/mcp`

Useful tools: `get_admin_review_tasks`, `resolve_admin_review_task`, `get_company_profile`, `update_company_profile`.

Agent-facing HTTP review API:
- `GET /api/admin/review-tasks?status=open`
- `PUT /api/admin/review-tasks` with `{"id":"...","status":"resolved"}`

Existing admin profile HTTP API:
- `GET /api/admin/company-profile?company=...`
- `PUT /api/admin/company-profile`

All admin APIs require the admin bearer token.

## Browser push

The admin review page is `/admin/review-tasks`.

Configure `HUNT_ADMIN_VAPID_PUBLIC_KEY`, `HUNT_ADMIN_VAPID_PRIVATE_KEY`, and `HUNT_ADMIN_VAPID_SUBJECT` (for example `mailto:admin@example.com`). Generate a VAPID keypair with `npx web-push generate-vapid-keys` after installing dependencies.

The private key stays server-side. The browser receives only the public key.

If VAPID variables are absent, review tasks still persist and remain available through Admin MCP and the admin HTTP API; Hunt simply does not attempt a browser push.

## Verification rule

`verified` means Hunt has source evidence it can safely expose as authoritative company profile data.

`needs_review` means Hunt encountered evidence but could not safely interpret or extract it.

`admin_supplied` means the administrator/agent supplied the record.

`unverified` means evidence exists but has not been promoted to authoritative profile data.

No status should be used to hide the original source.
