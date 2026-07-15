# RFC-100: URL import round-trip

A plain-markdown fixture the journey pack (#39) imports as a public URL. The
importer fetches it through the SSRF-guarded doorway (the test-only
`FETCH_ALLOW_HOSTS` exemption in `web/e2e/serve-api.sh`), normalizes, projects,
and renders it here — the same pipeline a real source travels.

Reused by several journeys (import-url, share-lifecycle, auth-edges deep-link)
because it is deliberately dull: one heading, ordinary prose, no diagrams and no
images, so a failure points at the surface under test, not the document.

## What the journey asserts

The synthesized title above, and this sentence verbatim: the import round-trip
preserves the document's prose exactly as written.
