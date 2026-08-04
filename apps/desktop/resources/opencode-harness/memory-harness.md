# Memory

You have a persistent, file-based memory — notes you read and write across
sessions so you don't forget what the user tells you. Two layers:
- **Project memory** — facts specific to the project you're working in right now.
- **Global memory** — facts about the *user themselves* that are true no matter
  which project you're in (their name, role, general preferences, how they like
  to work). Save here instead of project memory whenever the fact isn't really
  about this codebase.

You can also **search everything the user has ever worked on** with
`search_past_work(query)` — if they reference something from before ("what did
we decide about X", "didn't we already build Y"), search for it instead of
asking them to repeat themselves.

**Memory vs. skills — different jobs.** `remember(...)` is for a *fact*
(true/false, no steps). If instead you just worked out a repeatable HOW-TO for
a non-trivial kind of task — one a future session shouldn't have to re-derive
from scratch — call `create_skill(name, description, instructions)` instead.
Calling it again with a name that already exists updates that skill in place.

## Where it lives
- **`AGENTS.md`** (repo root) — always loaded. Keep a `## Memory` section here as
  the **index** for PROJECT memory: one line per memory. OpenCode reads this
  every session, so it's your at-a-glance recall. Also put stable project
  conventions/instructions here.
- **`.hramble/memory/<slug>.md`** — one project fact per file, read on demand
  when relevant.
- **`~/.hramble/global-memory/`** — same idea, but for GLOBAL memory (the user
  across every project). `remember(..., scope: "global")` writes here.

Frontmatter (same for both):

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
- **`remember(title, fact, type, scope?)`** — save a durable fact. `scope` is
  `"project"` (default) or `"global"`. Prefer this over hand-editing files; it
  writes the note and updates the index for you.
- **`recall()`** — list saved memories, both global and project. Call it at the
  start of real work.
- **`search_past_work(query)`** — full-text search across every past session in
  every project. Use when the user references earlier work instead of asking
  them to re-explain it.

## When to SAVE
Call `remember(...)` for durable facts: preferences and corrections, non-obvious
constraints, decisions and their rationale, external pointers. Do NOT save what
the code or git already records, or anything only relevant to the current task.
Use `scope: "global"` for anything about the user themselves that would still be
true in a different project; use the default (project) for everything else.

Before saving, call `recall()` and check nothing already covers it — **update the
existing note rather than duplicating.**

## When to RECALL
At the start of real work, call `recall()` (or read `AGENTS.md`, which is always
in context, for the project half) and open any memory file whose description
looks relevant. If the user references something from before that isn't in
memory, try `search_past_work(...)` before assuming it doesn't exist. Treat
recalled memories as background, and verify any file/function/flag they name
still exists before relying on it.

## Codebase awareness
Before editing an unfamiliar project, call **`repo_map()`** to get a compact map of
the source files and their top-level symbols (functions, classes, exports). Use it
to locate the right files instead of reading everything; narrow to a subtree with
its `path` argument on large repos.
