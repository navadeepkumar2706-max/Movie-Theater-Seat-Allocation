---
name: Seat allocation preference scoring
description: Why contiguous seat blocks need aggregate zone scoring.
---

When comparing contiguous seat candidates, score the whole block by the sum of each seat's preference rank. A mixed-zone block can contain one seat in the preferred zone and otherwise be a worse fit; ranking only by the best seat incorrectly ties it with an all-preferred-zone block.

**Why:** A request's preferred zone should influence the full party placement, while the together preference should not make a single preferred seat outweigh a consistently better zone fit.

**How to apply:** Preserve aggregate zone scoring when changing candidate tie-breakers, and test a mixed-zone block against a fully preferred-zone block.