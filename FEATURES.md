# Hramble — feature map

Where each coding feature lives, so nothing feels "missing." Most of this comes
from the palot/OpenCode base; the **Hramble additions** are marked ★.

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
