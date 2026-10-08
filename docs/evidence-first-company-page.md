# Hunt — Evidence-First Company Page

## Product decision

The company page is an intelligence brief, not an adapter/debug dashboard.

The primary visual hierarchy is:

### 1. Latest change

A concise statement of what changed, backed by specific evidence.

### 2. Evidence

Each important claim must be inspectable through its source URL and bounded context where available.

### 3. Evidence intersection

Show the independent evidence families that changed together. Do not call this a commercial opportunity.

### 4. Unknown / needs investigation

Explicitly expose missing, contradictory or weak evidence.

### 5. Company context

Contacts, financial records, footprint and other durable context remain source-backed.

### 6. Raw history

Available for audit, but not the first thing a user sees.

## UI language

Good:

- "3 independent evidence families changed within 14 days."
- "Regulatory + expansion evidence intersected."
- "Source evidence is reachable."
- "No verified financial statement found."
- "Investigate the underlying evidence."

Bad:

- "Potential platform demand."
- "Likely buyer."
- "High intent."
- "Company needs cybersecurity."
- "Commercial opportunity detected" when the only basis is category overlap.

## Evidence card

Each evidence card should expose:

- family/category
- title
- source
- observed date
- status
- confidence
- short source context
- source link

The context is evidence, not an AI summary.

## Cluster card

A cluster card should show:

- "Evidence intersection"
- category/family chips
- number of independent source families
- observation count
- time window
- evidence links

Its score, if shown, must be labelled as evidence strength.

## Investigation boundary

Hunt may say:

> "These observations changed together."

An external AI/user may then ask:

> "Does this create a need for insurance, financing, engineering, procurement support, trade finance, security, or another service?"

That separation is intentional.
