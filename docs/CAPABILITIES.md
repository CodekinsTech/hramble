# Hramble — What It Can Do

A living list of everything Hramble ships with, so you always know what your app
has and can do. Update this whenever a feature, tool, or skill is added.

_Last updated: 2026-07-29_

---

## Core (coding companion)
Hramble is an AI coding companion for developers. The agent can read, search,
write, and edit code across your project, run commands, and verify its work.

- **Chat coding** — describe a task, the agent does it (read/write/edit files, run
  the terminal, search the codebase).
- **Step List** — queue up to 7 steps and run them in sequence; each waits for the
  previous to finish. Works in Code and Hyperloop modes. Per-step ✓, live editing,
  stop/clear.
- **Modes**
  - **Code** — normal request → act.
  - **Hyperloop** — autonomous "keep going until done" mode.
  - **Plan** — plan first, then execute.
  - **Permission modes** — Manual / Accept-Edits / Auto / Bypass (control what runs
    without asking).
- **Sub-agents** — the agent can delegate subtasks to parallel helper agents.
- **Memory** — remembers durable facts across sessions (`remember` / `recall`).
- **Checkpoints / undo-redo** — revert the agent's changes.
- **Compaction** — long chats are summarized automatically to stay in context.

## Panels & UI
- **File Explorer** (Cmd+Shift+E) — browse the project tree.
- **Review / Changes panel** (Cmd+Shift+D) — see and comment on diffs.
- **In-app Browser** (Cmd+Shift+B) — a real embedded browser the agent can also
  drive (open, read, click, type, submit, screenshot) while you watch.
- **Command palette**, slash commands, todo list, cost tracking.

## Agent tools & plugins (what the agent can call)
Built-in: `read`, `write`, `edit`, `apply_patch`, `glob`, `grep`, `bash`, `task`
(sub-agents), `webfetch`, `websearch`, `lsp`, `todowrite`, `skill`.

Hramble additions:
- **`repo_map`** — a compact map of the codebase (files + their functions/classes)
  so the agent finds the right files fast.
- **`remember` / `recall`** — long-term memory.
- **`browser`** — drive the in-app browser pane (open/read/click/type/screenshot).

## Connectors (MCP)
Add integrations from Settings → Connectors (same mechanism Claude uses):
Web Search (free / Exa / SearXNG / Tavily / Brave), Browser (Playwright),
Chrome DevTools, Filesystem, GitHub, Postgres, Sequential Thinking, and custom.

## Local models
Run fully offline with **Ollama** (bring a local coding model). Hosted models
(via API key) also supported for stronger results.

---

## Bundled Skills
Skills are `SKILL.md` playbooks the agent loads on demand (type `/` in chat, or the
agent picks one when a task matches). See `skills/NOTICE.md` for licenses.

### Workflow (universal)
- **iterate-until-verified** — execute → verify → repeat loop for any substantial task.
- **audit-verify-explain-grade-5** — audit work, verify claims with evidence, explain simply.
- **article-prompts-to-skills** — turn any article/doc into new reusable skills.

### Web / UI toolkit
- **tailwindcss** — Tailwind layout, typography, theming.
- **gsap** — professional web animations (timelines, ScrollTrigger).
- **threejs** — interactive 3D scenes on the web.
- **animation-systems** — product-grade web motion (Stripe/Linear/Apple style).
- **landing-page** — high-converting single-offer landing pages.
- **design-first-ui-prompting** — spec-driven, skimmable UI generation prompts.

### Video (on-demand)
- **hyperframes** — generate MP4 videos from a description (promos, explainers,
  slideshows, captioned clips, motion graphics). Powered by HeyGen HyperFrames.
  **On-demand:** the render toolchain (CLI + headless Chromium, and FFmpeg if
  needed) downloads the first time you ask for a video — nothing heavy is installed
  up front.

---

## Adding more skills
Drop any `SKILL.md`-format skill folder into `skills/` (they ship with the app) and
it becomes available to the agent. Good sources: MengTo/Skills (MIT), HeyGen
HyperFrames (`npx hyperframes skills update` pulls more video skills on demand).
Keep licenses/attribution in `skills/NOTICE.md`.
