# Hunt Intelligence Upgrade Roadmap

## Goal

Make Hunt a top-tier evidence-first company intelligence engine rather than a hardcoded signal/finding generator.

## Phase 1 — Evidence boundary

- [x] Persist source tier and verification metadata.
- [x] Preserve source URLs.
- [x] Keep evidence visible through timeline/history.
- [x] Remove hardcoded commercial conclusions from monitor-generated signals.
- [x] Make official website identity stable across content snapshots.
- [ ] Introduce first-class immutable evidence records where observation storage is insufficient.
- [ ] Preserve bounded source excerpts/locators for important evidence.
- [ ] Add evidence integrity/content hashes consistently across adapters.

## Phase 2 — State and change

- [x] Durable observation history.
- [x] Missing/suspected-missing/confirmed-removed lifecycle for public surfaces.
- [ ] Generalize lifecycle state across signal families.
- [ ] Add explicit observation revisions/snapshots for mutable observations.
- [ ] Compute semantic diffs instead of treating every content change as a new finding.
- [ ] Distinguish "new", "changed", "unchanged", "restored", "removed", and "unknown".

## Phase 3 — Entity resolution

- [ ] Canonical company identity.
- [ ] Alias registry.
- [ ] Official-domain verification.
- [ ] Legal/regulatory identifiers.
- [ ] Subsidiary/relationship graph.
- [ ] Source-specific entity IDs.
- [ ] Entity confidence and conflict handling.

## Phase 4 — Correlation

- [x] Cluster storage and time window fields.
- [ ] Temporal correlation based on event timestamps.
- [ ] Independent-source weighting.
- [ ] Source-family diversity.
- [ ] Contradiction detection.
- [ ] Duplicate/copy detection.
- [ ] Cluster evidence graph.
- [ ] Reproducible cluster scoring based on evidence properties rather than hardcoded commercial assumptions.

## Phase 5 — Signal families

Build adapters as evidence collectors, not conclusion generators:

- [x] jobs
- [x] official website
- [x] product/API surfaces
- [x] technology/domain intelligence
- [x] GitHub
- [x] leadership/people
- [x] procurement
- [x] public-site signals
- [x] first authoritative regulatory layer (SEC/CAC)
- [ ] CBN
- [ ] NDPC
- [ ] NITDA
- [ ] FCCPC
- [ ] funding/investment
- [ ] office/expansion
- [ ] supplier/customer evidence
- [ ] stronger security exposure evidence

## Phase 6 — Investigation

- [x] Opportunity investigation state.
- [x] Investigation notes.
- [ ] Evidence bundle endpoint designed for external AI.\n- [x] Company UI exposes evidence activity, source family, change state and bounded context.
- [ ] Claim/evidence linkage.
- [ ] Contradiction and missing-evidence reporting.
- [ ] External-AI investigation protocol.
- [ ] Investigation replay/audit trail.

## Phase 7 — Commercial boundary

Hunt should provide:

```
evidence -> observed change -> correlation -> investigation input
```

Cashflow should provide:

```
qualified requirement -> buyer/supplier workflow -> outreach -> execution
```

Do not connect the systems until Hunt's evidence semantics are trustworthy enough that Cashflow receives investigated opportunities rather than noisy signals.

## Acceptance test

For any company, Hunt should be able to answer:

1. What is the canonical company?
2. What did we observe?
3. Where did each observation come from?
4. When was it observed?
5. Is it still present?
6. What changed since the previous observation?
7. Which independent pieces of evidence changed together?
8. What is verified versus unknown?
9. What evidence contradicts the current interpretation?
10. What should an external investigator inspect next?

If Hunt cannot answer those questions from persisted evidence, the feature is not complete.
