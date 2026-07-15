# Import failure modes

- Fetch
  - SSRF-blocked URL → terminal, no retry
  - Upstream 5xx → transient, retry ×3
- Normalization
  - MDX compile failure → plain-markdown fallback
  - Failed image fetch → import warning
    1. Record the warning
    2. Continue the import
    3. Surface it on the document

1. First numbered step
2. Second numbered step
   - a bullet nested under an ordered item
