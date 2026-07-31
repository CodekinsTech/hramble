# Hramble — feature map

Where each coding feature lives, so nothing feels "missing." Most of this comes
from the hramble / OpenCode base; the **Hramble additions** are marked ★.

## Working in a project
- **Pick a folder** — on the new-session screen, the 📁 control → "Choose a
  folder…" (native picker). Warns if you're in your home folder. ★
- **File explorer** — in a session, the **Files** toggle (top bar) or
  **Cmd+Shift+E**. Click folders to expand, files to open. ★
- **Changes / diffs** — the **Changes** toggle (top bar) or **Cmd+Shift+D**.
  Every edit the agent makes shows an inline diff too.

## Driving the agent
- **Model picker** — the model dropdown in the composer. Non-chat models
  (whisper/TTS) are hidden. ★
- **Permission modes** — the mode chip in the composer cycles
  Plan → Manual → Accept Edits → Auto → Bypass (like Claude's Shift+Tab). ★
- **Think** — composer toggle: plans first, then acts (more reliable on weak
  models). ★
- **Slash commands** — type `/` in the composer (`/compact`, `/clear`, …).
- **@-mentions** — type `@` to reference files/agents.
- **Command palette** — **Cmd+K**.

## Autonomous & safety
- **Hyperloop** — top-of-sidebar workspace switch (**Code | Hyperloop**). Give
  one task; it works round after round until done. 15-round cap, stuck-detection,
  dangerous-command guard, **Esc** to stop. ★
- **Undo / checkpoints** — "Undo from here" button on any turn; per-turn revert.
- **Todo list** — the agent's live task list shows pinned in the session.

## Models
- **Local (free/offline)** — Ollama; first-run card offers a one-click pull.
  `qwen2.5-coder:7b` (small) / `qwen3-coder:30b` (bigger). ★
- **Hosted** — any provider via Settings → Providers (OpenRouter unlocks
  GLM/Kimi/Qwen; Groq is fast + free-tier).
- **Store** — Settings → Store: avatar catalogue (VRM), reuses the AvatarBox
  backend. ★

## Connectors, skills & ECC ★
- **Connectors** — Settings → Connectors: add/remove MCP servers (GitHub,
  browser, Postgres, …) from the UI, no JSON. Same mechanism as Claude's
  connectors. Restart OpenCode to apply.
- **Skills** — OpenCode auto-discovers skills; type `/` in chat to use one.
- **ECC commands** — a curated set of ECC's slash commands (`/ecc-verify`,
  `/ecc-code-review`, `/ecc-security`, `/ecc-tdd`, …) can be installed with
  `bash scripts/install-ecc-commands.sh`. Only the self-contained commands are
  installed (agents normalized to `build`); the full ECC harness is intentionally
  NOT auto-installed — it needs a build step and can degrade weak local models.

## Memory (notes style, like Claude) ★
Three layers, matching Claude Code:
- **Context memory** — OpenCode auto-compacts long chats.
- **Project memory** — `AGENTS.md` at the repo root (like `CLAUDE.md`), always
  read. Holds project conventions + a `## Memory` index.
- **Long-term notes** — `.hramble/memory/<slug>.md`, one fact per file with
  frontmatter (`name`, `description`, `type: user|feedback|project|reference`),
  recalled on relevance. The save/recall protocol is always in context via
  `docs/memory-harness.md` (wired through the OpenCode config `instructions`).

We chose the **notes** approach (what Claude uses) over a knowledge-graph MCP:
notes suit coding memory (conventions, preferences, gotchas), are human-editable,
and work with weak local models (read a file vs. operate graph tools). The graph
memory MCP is still available as a toggle in Settings → Connectors.

Setup for a fresh machine: copy `docs/memory-harness.md` to
`~/.config/opencode/` and add it to the config `instructions` array.

## The differentiator
- **Avatar companion** — VRM avatar that speaks (Supertonic TTS), listens (Vosk
  STT), and perches on your screen. This is Hramble's reason to exist; the coder
  itself is OpenCode. ★

## Notes for a strong experience
- Use a **capable model** (Groq `qwen/qwen3-32b`, or GLM/Kimi via OpenRouter) for
  reliable results. Small local models are great for simple builds, shaky on
  complex multi-file work.
- The **chrome-devtools MCP** (browser control) confuses weak models — use it
  with a strong model only.
