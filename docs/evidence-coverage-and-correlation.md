# Hunt — Evidence Coverage & Correlation Upgrade

## Why this change exists

The company page exposed a real product problem: Hunt already stores evidence, but its sensing surface is still too narrow and its cluster can mistake category overlap for meaningful independent evidence.

Hunt must not be a technology-signal detector. A company can create commercial relevance through:

- business expansion or contraction
- funding, investment, acquisition or financing
- insurance, risk, claims or coverage evidence
- procurement and contracts
- supplier/customer relationships
- leadership and key-person movement
- regulatory, licensing and compliance events
- litigation and disputes
- financial reporting
- ESG/local-content activity
- locations, facilities and operating footprint
- technology, security and product/API surfaces
- hiring and people movement

These are evidence families. Hunt does not decide what they mean commercially.

## New evidence pipeline

```
source
  -> adapter
  -> observation
  -> provenance + excerpt/context
  -> state/version
  -> observed change
  -> independent evidence families
  -> evidence cluster
  -> external investigation
  -> commercial action
```

## Adapter rule

An adapter is successful when it finds attributable public evidence, not when it produces a commercial conclusion.

It may collect:

- source URL
- source family
- source tier
- title
- bounded source context/snippet
- observed timestamp
- stable fingerprint
- evidence confidence
- entity confidence
- change metadata

It must not emit:

- "company needs X"
- "buy/sell opportunity"
- "high intent"
- "likely customer"

Those belong to investigation outside Hunt.

## Coverage expansion

The monitor now treats these as first-class evidence families:

1. Jobs / people
2. Official company surfaces
3. Product/API surfaces
4. Technology/domain intelligence
5. GitHub
6. Procurement
7. Leadership/key people
8. Public company disclosures
9. Regulatory/authoritative sources
10. Funding/investment
11. Expansion/location
12. Supplier/customer/partnership
13. Insurance/risk
14. Litigation/legal
15. Financial reporting
16. Business/operations

The list is deliberately broader than technology.

## Correlation rule

A cluster is evidence correlation, not a finding.

A strong cluster should prefer:

- recent evidence
- multiple evidence categories
- multiple independent source families
- reachable/verified evidence
- genuinely new or changed observations
- no duplicate/copy inflation

Repeated pages from the same source family should not count as independent corroboration.

Cluster scores therefore describe **evidence strength**, not commercial attractiveness.

## Company-page rule

The company page should answer in this order:

1. What changed?
2. What evidence supports that?
3. Which independent sources changed together?
4. What remains uncertain?
5. What should an investigator inspect next?

Internal counts and scores are secondary diagnostics.

## Acceptance test

For Dangote Refinery, a valid scan should be capable of surfacing business evidence even when no technology evidence exists.

For example, a cluster might contain:

- expansion/location evidence
- regulatory evidence
- supplier/customer evidence
- financial evidence

and Hunt must present those facts without converting them into a technology conclusion.

## Non-goals

- sentiment scoring
- media-spike scoring
- generic "company needs software" rules
- hidden LLM inside Hunt
- replacing evidence with a hardcoded opportunity taxonomy
