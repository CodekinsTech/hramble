# Project context — `HRAMBLE.md`

Hramble auto-loads a per-project context file into every agent session, so you
don't have to re-explain your project each time. Drop a `HRAMBLE.md` at the root
of any project and Hramble reads it automatically at the start of a session.

This is the same idea as Claude Code's `CLAUDE.md` or Cursor's rules — a small,
durable brief that makes answers accurate from the first turn.

## How it's loaded

At session start Hramble walks up from the working directory to the project root
and loads the first of these it finds, plus the global one in
`~/.config/opencode/`:

1. `HRAMBLE.md`  (preferred — Hramble-native)
2. `AGENTS.md`   (also supported, for cross-tool compatibility)

The contents are injected as ambient instructions — the agent treats them as
project ground-truth, not as a message to answer.

## What to put in it

Keep it **short**. Only add things the agent would otherwise get wrong or have
to rediscover every session:

- **Stack & structure** — languages, framework, where the important code lives.
- **Commands** — how to run, build, test, and lint (exact commands).
- **Conventions** — naming, formatting, patterns this project insists on.
- **Footguns** — the mistakes a newcomer (or an agent) makes here, and the fix.

Do **not** put one-time setup notes, general knowledge, or anything discoverable
from config files — that just wastes context.

## Starter template

```markdown
# <Project name>

## Stack
- Language / framework:
- Package manager:
- Key directories:

## Commands
- Install:
- Dev / run:
- Test:
- Lint / format:

## Conventions
-

## Gotchas
-
```

Copy that into `HRAMBLE.md` at your project root, fill in the blanks, and every
Hramble session in that project starts already knowing how to work in it.
