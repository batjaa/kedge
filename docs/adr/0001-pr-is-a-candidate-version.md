# A pull request is a candidate version, not a separate document

Status: accepted (2026-07-15)

Kedge's moat is comments surviving document versions. Today a PR-branch file
can be imported via its blob URL, which creates a *separate document* — and any
comments on it are stranded when the PR merges, never rejoining the main
document's lineage. We decided the domain meaning instead: **a PR resolves to
candidate version(s) of the existing document(s) it touches.** Review happens
on the candidate; when the PR merges, the source re-syncs and comments
re-anchor into the document's lineage like any other version transition. A PR
touching several documents surfaces as one review event resolving to several
candidate versions.

## Considered options

- **Separate document per PR ref** (status quo): simplest, already works, but
  the re-anchoring story stops at branch boundaries — it silently abandons the
  product's core promise exactly where teams review hardest.
- **Defer until M3**: rejected because M3's version-lineage schema is being
  designed now; choosing later risks a linear-only lineage that can't express
  candidates without migration surgery.

## Consequences

- The Versions module (M3) must model lineage-with-candidates, not a strictly
  linear version chain.
- A future PR-URL connector resolves to candidates on existing documents — it
  must not mint new document identities.
- Nothing in shipped M1 changes: blob-URL-at-ref imports still create
  documents; candidates arrive with M3+/M6 work.
