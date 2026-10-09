# Evidence identity and verification semantics

Hunt stores several different confidence questions separately. They must not be collapsed into one score.

- **Entity confidence** asks whether an observation belongs to the company record being monitored.
- **Evidence confidence** asks how strong the source/provenance is.
- **Verification status** records the observation/source state; a reachable URL is not proof that every statement on the page is true.
- **Claim verification** remains independent. A first-party page can establish that the company published a claim without independently proving the claim itself.

## Exact canonical-host rule

When an observation URL's hostname exactly matches the company's canonical domain after removing only a leading `www.`, Hunt may mark the entity identity as verified and raise entity confidence. It must not infer identity from a sibling hostname or arbitrary subdomain. For example, `dangote.com` and `www.dangote.com` normalize to the same host, but `refinery.dangote.com`, `ipo.dangote.com`, and `investors.dangote.com` remain distinct hosts until independently linked or verified.

Template-suspected content is excluded from this automatic identity-confidence increase.

For an exact canonical-host match, Hunt records:

- `entityIdentityVerified: true`
- `entityIdentityBasis: exact_canonical_hostname_match`
- `claimVerificationStatus: source_observed_not_independently_verified`

The identity score can therefore rise without falsely upgrading the underlying claim to independently verified.

## Operational consequence

A subsequent successful monitoring run recalculates the quality fields for observations it refreshes. This code does not retroactively rewrite every historical observation, and it does not mark failed Prisma migrations as successful. Database schema recovery remains a separate, inspected operation.
