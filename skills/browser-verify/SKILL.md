---
name: browser-verify
description: Verify a running web app actually works by driving a real browser — navigate, click, fill forms, read console/network logs, screenshot. Use after building or changing a website/game/UI to confirm it works, not just that it compiles. Do NOT use for static design comparison against a reference site (use the built-in Inspect Design tool in the browser pane for that).
metadata:
  inspiration: Adapted from Anthropic's webapp-testing skill (github.com/anthropics/skills, Apache-2.0), rewritten for Hramble's connected browser tools
  version: "1.0.0"
---

# Browser Verify

Passing a type-check or a build is not the same as the feature working. Once
a dev server is running, drive the actual page instead of reading the source
and assuming — a broken selector, a JS error on load, or a form that
silently fails to submit is invisible from the code alone.

## Which browser tool to reach for

Hramble already exposes a browser two ways — use whichever fits:

- **The app's own Browser pane** (already open during a Website/Browser Game
  session) — good for a quick visual check, screenshots, or Inspect Design
  against a reference site.
- **The "Browser (built-in)" connector** — a real Playwright MCP server
  (`connectors.ts` preset id `playwright`) — use this when the check needs
  to be scripted: click a button, fill a form, read `console` output, assert
  on rendered text. If it's not connected yet, connect it from Settings →
  Connectors or the agent hub's "Connect your tools" card before starting.

Don't write a standalone Python `playwright` script for this — the connector
gives the agent the same navigate/click/screenshot/console-log tools
directly, with no extra process to manage or file to clean up afterward.

## Decision tree

```
Is the dev server already running?
  No  → start it first (the agent already has a terminal/process tool for
        this), THEN verify — don't try to verify against a dead port.
  Yes → is the page static HTML or a dynamic SPA?
        Static  → navigate + read the DOM directly; selectors are stable.
        Dynamic → navigate, THEN WAIT for the app to actually settle
                   (network idle / the expected element to appear) BEFORE
                   inspecting or clicking — inspecting mid-render is the
                   single most common cause of a false "it's broken" result.
```

## Reconnaissance before action

1. Navigate to the page.
2. Wait for it to settle — don't screenshot or query selectors the instant
   navigation resolves on a dynamic app; the DOM may still be one render
   behind.
3. Read the rendered DOM / take a screenshot to find real selectors —
   never guess a selector from memory of the source file, confirm it
   actually exists in what's rendered.
4. Only then execute the click/fill/submit action, using the selector just
   confirmed.

## What actually counts as "verified"

- The page loaded with no console errors (check the console log, don't
  assume silence).
- The specific thing that was built/changed is visibly present and does
  what it's supposed to — not just "the page didn't crash."
- For a form or interactive flow: the full flow was exercised end to end
  (submit → see the expected result), not just that the button exists.

If any of these can't be confirmed through the browser tool, say so plainly
instead of reporting success — "I couldn't verify X, the connector timed out
navigating to Y" is more useful than a false "done."
