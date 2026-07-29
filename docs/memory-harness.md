# Memory

You have a persistent, file-based memory kept **inside the current project** —
notes you read and write across sessions so you don't forget what the user tells
you. Same idea as a CLAUDE.md plus a notes folder.

## Where it lives (in the repo you're working in)
- **`AGENTS.md`** (repo root) — always loaded. Keep a `## Memory` section here as
  the **index**: one line per memory. OpenCode reads this every session, so it's
  your at-a-glance recall. Also put stable project conventions/instructions here.
- **`.hramble/memory/<slug>.md`** — one **fact per file**, read on demand when
  relevant. Frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to judge relevance later>
type: user | feedback | project | reference
---

<the fact. For feedback/project, add **Why:** and **How to apply:** lines.
Link related memories with [[their-slug]].>
```

Types: **user** = who the user is (role, stack, expertise). **feedback** = how to
work with them (corrections + confirmed approaches; include the why). **project**
= ongoing goals/constraints not derivable from the code. **reference** = pointers
(URLs, tickets, dashboards).

## Tools (baked into the engine)
- **`remember(title, fact, type)`** — save a durable fact. Prefer this over
  hand-editing files; it writes the note and updates the index for you.
- **`recall()`** — list saved memories. Call it at the start of real work.

## When to SAVE
Call `remember(...)` for durable facts: preferences and corrections, non-obvious
constraints, decisions and their rationale, external pointers. Do NOT save what
the code or git already records, or anything only relevant to the current task.

Before saving, read the `## Memory` index in `AGENTS.md` and check for a file that
already covers it — **update it rather than duplicating.** After writing a memory
file, add/refresh its one-line pointer in the `AGENTS.md` `## Memory` index:
`- [Title](.hramble/memory/slug.md) — one-line hook`.

## When to RECALL
At the start of real work, read `AGENTS.md` (always in context) and open any
`.hramble/memory/*.md` whose description looks relevant. Treat recalled memories as
background, and verify any file/function/flag they name still exists before
relying on it.
