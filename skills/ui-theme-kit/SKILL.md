---
name: ui-theme-kit
description: Apply a cohesive, pre-vetted color palette + font pairing to a website or app instead of picking colors ad hoc. Use when starting a new site/UI and the user has no brand colors yet, or asks for a specific mood ("make it feel warm," "something like a tech startup"). Do NOT use once a user has given real brand colors/fonts, or reference sites to match (use Inspect Design to pull real values from those instead) — this is for filling a gap, not overriding a given identity.
metadata:
  inspiration: Adapted from Anthropic's theme-factory skill (github.com/anthropics/skills, Apache-2.0) — rewritten for websites/UI instead of slide decks, no external showcase file needed
  version: "1.0.0"
---

# UI Theme Kit

A site with no chosen colors tends to drift toward the same few AI defaults
(purple gradients, generic blue-on-white, `rounded-lg` everywhere). Picking
from a small set of deliberately different, complete palettes — instead of
inventing one color at a time — gets to a coherent result faster and avoids
that drift.

## Usage

1. **Ask what mood fits**, if it isn't obvious from the request — one short
   question, not a full design interview (that's `frontend-blueprint`'s job
   for bigger projects). "Which of these feels right: warm & approachable,
   clean & minimal, or bold & modern?" is enough to pick a lane.
2. **Pick the closest theme below** rather than starting from nothing.
3. **Apply consistently** — the palette's accent is the ONE saturated color;
   everything else routes through its neutrals. Both light and dark variants
   should use the same accent, adjusted for contrast, not a different hue.
4. If none of the below genuinely fits the request, generate a new one using
   the same structure (primary, accent, 2 neutrals, heading font, body font)
   — don't half-apply an existing theme when the brief clearly wants
   something else.

## Themes

Each entry: primary / accent / neutral-light / neutral-dark, then a font
pairing (heading / body).

1. **Slate Harbor** — `#1c2b3a` / `#3b82f6` / `#f4f6f8` / `#0f1720` — clean,
   trustworthy, SaaS-default-adjacent but with real contrast. Sora / Inter.
2. **Terracotta Studio** — `#7c4a2d` / `#e07a4f` / `#faf3ea` / `#2b1c14` —
   warm, craft/creative-brand feel. Fraunces / Source Sans 3.
3. **Signal Green** — `#0d1f17` / `#22c55e` / `#f0f7f2` / `#08120d` — bold,
   tech/dev-tool energy without leaning on purple. Space Grotesk / Inter.
4. **Ink & Paper** — `#111111` / `#d94f36` / `#faf9f6` / `#000000` —
   near-monochrome with one warm accent, editorial/confident. Instrument
   Serif / Inter.
5. **Coastal Fog** — `#3a4a52` / `#0891b2` / `#eef4f5` / `#1a2327` — calm,
   coastal/wellness-adjacent, cool but not cold. Fraunces / Work Sans.
6. **Amber Circuit** — `#2a1f0d` / `#f5a524` / `#fdf8ee` / `#150f06` —
   energetic, builder/maker-brand. Space Grotesk / IBM Plex Sans.
7. **Plum Field** — `#2e1f38` / `#a855f7` / `#f7f1fb` / `#160c1c` — the one
   deliberately purple option — use it only when purple is actually the
   right call, not the default.
8. **Midnight Slate** — `#e8ecf1` / `#60a5fa` / `#0b1220` / `#f4f7fb` —
   dark-mode-first theme (colors listed light-on-dark); invert for a light
   variant rather than picking a separate palette.

## Applying to code

Set these as CSS custom properties at the root (`--color-primary`,
`--color-accent`, `--color-bg`, `--color-ink`) rather than hardcoding hex
values through the markup — makes a later swap or a dark-mode pass a token
change, not a find-and-replace across every file.
