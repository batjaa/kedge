---
title: Anchoring RFC
description: How comments survive re-sync
projection_version: 1
tags:
  - moat
  - anchoring
---

# Re-anchoring

Comments are bound to a **plain-text projection**, not to line numbers. When a
new version arrives, each anchor is relocated by its `exact`/`prefix`/`suffix`
quote.

## Why offsets, not lines

Line numbers shift on every edit; a quote survives a re-flow. The frontmatter
above is metadata and must never appear in the anchor substrate.
