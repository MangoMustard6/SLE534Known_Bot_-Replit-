---
name: Pitch mix gain
description: User-directed audio mixing behavior for the 534 video bot.
---

Pitch-shifted audio layers must be summed without normalization. This preserves each layer's gain and can cause clipping when several layers are mixed.

**Why:** The user explicitly requested no normalization on October 5, 2026.

**How to apply:** Preserve unnormalized mixing for pitch effects and keep a warning that summed layers may clip. Only change this behavior if the user asks.
