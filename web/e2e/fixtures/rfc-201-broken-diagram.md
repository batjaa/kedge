# RFC-201: Broken diagram surfaces the renderer error

A fixture with a mermaid fence whose FIRST token is not a known diagram type, so
Kroki's mermaid engine rejects it with a parse error (issue #56). The render must
degrade to the never-crash source panel AND show Kroki's own message beside the
source, so an author can fix the diagram without leaving the page.

## Broken diagram

```mermaid
notarealdiagramtype
  fetch --> render
  render --> zoom
```
