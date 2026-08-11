# hramble

### Your independent AI coding companion — multi-agent workflows, memory, and a voice built in.

[![CI](https://github.com/worldkingk777/hramble-code/actions/workflows/ci.yml/badge.svg)](https://github.com/worldkingk777/hramble-code/actions/workflows/ci.yml)
[![Release](https://github.com/worldkingk777/hramble-code/actions/workflows/release.yml/badge.svg)](https://github.com/worldkingk777/hramble-code/actions/workflows/release.yml)
[![GitHub release](https://img.shields.io/github/v/release/worldkingk777/hramble-code?include_prereleases&label=version)](https://github.com/worldkingk777/hramble-code/releases)
[![GitHub Downloads](https://img.shields.io/github/downloads/worldkingk777/hramble-code/total?label=downloads)](https://github.com/worldkingk777/hramble-code/releases)
[![License](https://img.shields.io/badge/license-FSL--1.1-blue.svg)](LICENSE)

> **Alpha Software** -- Hramble is under active development. Expect breaking changes, missing features, and rough edges. Feedback and contributions are welcome!

---

## What is Hramble?

Hramble is a desktop AI coding companion with its own harness, prompts, and workflow features on top of a real agent execution engine — not a thin wrapper around a terminal tool. It manages multiple projects and sessions from one window, decomposes a goal into steps it runs in parallel without you babysitting each one, remembers context across your whole codebase and past sessions, and talks to you with a voice and an animated companion instead of staying a silent text box.

<br>

## Features

### Hyperloop — parallel, unattended builds

- **7-step queue coding** -- Describe a goal and Hyperloop splits it into up to 7 parallel steps (more via chained loops for bigger plans), launches them together, and runs a verify → repair loop on each one automatically. You don't sit there approving every single step — check back when it's done.

- **Live, plain-language step summaries** -- Each step ends with a short "what changed, what's next" summary the moment it finishes, not a wall of raw agent output you have to read through.

- **Model-aware concurrency** -- Detects whether you're on a local or hosted model and paces execution accordingly (strict one-at-a-time for local models, a bounded concurrent pool for hosted ones), so it stays fast without overloading either your machine or your API rate limits.

- **Manual queue mode** -- Prefer to run one step at a time and inspect each before the next starts? A single toggle switches Hyperloop from fully automatic to a manual queue.

### 7 Specialized Agents

Purpose-built starting points for Website, Browser Game, Backend Manager, Mobile App, Data & Automation, Browser Extension, and CLI & Dev Tools -- each with:

- A guided build path (reference sites/games to pull real inspiration from, a Design Studio vs. template fork for Website)
- **Real MCP connectors** relevant to that agent (e.g. Figma/GitHub/Supabase for Website, Postgres/Cloudflare for Backend, Firebase for Mobile) -- one click to actually connect the agent to that tool, not just a link out
- **Suggested Git repos** verified real, worth studying for that kind of build
- A goal box that hands everything you picked straight to the agent as its brief

### Chat & Agent Interaction

- **Multi-project workspace** -- Manage AI sessions across all your projects from a single window. OpenCode is scoped to one project per instance; Hramble lifts that limitation.

- **Full chat interface** -- Conversational UI with real-time SSE streaming, Markdown rendering, auto-scroll, lazy-load pagination, and draft persistence across session switches.

- **Undo / redo** -- `Cmd+Z` to revert the agent's last turn (including file changes), `Shift+Cmd+Z` to redo.

- **Slash commands** -- Type `/` to invoke server-side commands like `/compact` and `/help` directly from the chat input.

- **File and context mentions** -- Use `@` to reference files or specific context, giving the agent precise scope.

- **Rich tool call visualization** -- Every tool call is rendered inline:
  - File reads with line numbers and syntax highlighting
  - Edits as inline diffs (old vs new)
  - Bash commands with ANSI-colored terminal output
  - Search results (glob, grep) with matched patterns
  - Web fetches with URL and content preview
  - Task lists with real-time progress tracking

- **Sub-agent cards** -- Live activity cards for delegated tasks, with collapsible child session views and automatic collapse on completion.

- **Model and agent selector** -- Searchable model picker across all connected providers (Anthropic, OpenAI, Google, and more), with reasoning variant support, a "recently used" section, and favorites. Switch between available agents.

- **Permission management** -- Inline approve/deny UI for agent permission requests, with "allow once" and "allow always" options.

- **Interactive questions** -- Radio, checkbox, and free-text input for agent questions, with keyboard shortcuts.

- **File attachments** -- Drag-and-drop images (PNG, JPEG, GIF, WebP) and PDFs into the chat, with model capability warnings.

- **Session compaction** -- Summarize long conversations to reclaim context window tokens, manually or automatically.

### Review & Git Workflow

- **Review panel** -- A dedicated, collapsible side panel that shows all file changes from the current session. Powered by virtualized rendering and a worker pool for off-thread syntax highlighting, so it stays fast even with hundreds of changed files.

- **Diff commenting** -- Click any line in the diff viewer to leave a comment. Comments are automatically collected and injected into the chat input so you can send feedback to the agent in one go.

- **Commit and push** -- Integrated dialog to create branches, commit changes, push to remotes, and open a GitHub Pull Request, all without leaving Hramble.

- **Smart diff gates** -- Auto-collapses generated files (lockfiles, etc.) and very large diffs to keep the review panel responsive.

### Memory & Skills

- **Cross-project memory** -- Facts and preferences learned in one project carry over to the next, instead of re-explaining yourself every session.

- **Global session search** -- Search across every past session in every project, not just the one you're currently in.

- **100+ bundled skills** -- A library of ready-to-use agent skills (CC-BY-4.0), invoked with `/` in chat.

- **Create your own skill** -- Turn a pattern you use often into a reusable skill, saved to the same library as the bundled ones.

### Team Spaces & Community

- **Team Spaces** -- A shared workspace for a team's sessions, with a Combine feature that merges parallel work via a real `git merge`, not a manual copy-paste.

- **Community feed** -- Share what you built, browse what others are building, and install a shared skill in one click -- filterable by tag (e.g. by agent type, so the Website agent's community feed only shows website builds).

### Avatar & Voice Companion

- **Talk to Hramble** -- A mic button for voice input, so you can describe what you want out loud instead of typing.

- **Animated companion** -- A live avatar that reacts to what's happening in your session, with narration you can mute, collapse to a compact bar, or pop out as its own floating window.

### Automations

- **Scheduled agent runs** -- Define recurring tasks with RRule-based scheduling. Hramble runs the agent in the background and queues the results for your review.

- **Human-in-the-loop review** -- Automation runs land in a `pending_review` state so you can inspect changes in the review panel before accepting or archiving them.

- **Auto-archiving** -- Runs with no actionable changes are automatically archived to keep the list clean.

- **Retry with backoff** -- Configurable execution retries with exponential backoff for flaky tasks.

### Migration & Onboarding

- **Migrate from Claude Code and Cursor** -- A guided wizard detects existing configurations and chat history from Claude Code and Cursor. It converts global/project settings, MCP servers, custom agents, commands, rules (e.g. `CLAUDE.md` to `AGENTS.md`), and hooks to the OpenCode format.

- **History import** -- Convert past sessions and conversations from Cursor (`state.vscdb`) and Claude Code into OpenCode, so you don't lose context when switching.

- **Backup and restore** -- Automatic backups before any migration, with a one-click restore option.

- **CLI setup helper** -- Built-in UI to check, install, or repair the OpenCode CLI environment.

### Desktop & OS Integration

- **Liquid Glass (macOS 26+)** -- Native `NSGlassEffectView` window chrome on macOS Tahoe, with vibrancy fallback for older versions and an opaque mode for other platforms.

- **System accent color** -- The UI adapts to the OS accent color on macOS and Windows.

- **System tray** -- Runs in the background with a tray icon (including a dedicated Linux variant).

- **Dock / app badges** -- Badge count on the app icon for pending tasks or required permissions.

- **Secure credential storage** -- Encrypts server passwords and API keys using Electron's `safeStorage`.

- **mDNS server discovery** -- Automatically scans the local network for OpenCode servers, letting you connect to remote or headless instances.

- **Open in editor** -- Quick-launch buttons to open the current project in VS Code, Cursor, JetBrains IDEs, or the terminal.

- **Command palette** -- `Cmd+K` to search sessions, switch projects, toggle feature flags, and run commands.

- **Auto-updates** -- Built-in update mechanism with download progress and one-click restart.

<br>

## Download

| Platform | Architectures | Formats |
|----------|---------------|---------|
| macOS | Apple Silicon, Intel | DMG, ZIP |
| Windows | x64, ARM64 | NSIS installer |
| Linux | x64 | AppImage, DEB, RPM |

Download the latest release from the [Releases page](https://github.com/worldkingk777/hramble-code/releases).

### macOS: unsigned app warning

Hramble is not yet code-signed or notarized. macOS Gatekeeper will block the app on first launch with a message like *"Hramble is damaged and can't be opened"* or *"Apple could not verify Hramble"*. To fix this:

**Option A** -- Right-click (or Control-click) the app in Finder and select **Open**, then click **Open** in the dialog.

**Option B** -- Remove the quarantine attribute from the terminal:

```bash
xattr -cr /Applications/Hramble code.app
```

This is expected behavior for unsigned apps and does not indicate malware.

<br>

## Getting Started

### From a release (recommended)

1. Download and install from the [Releases page](https://github.com/worldkingk777/hramble-code/releases)
2. On first launch, Hramble walks you through a guided setup: it checks your environment and, if the OpenCode CLI isn't installed yet, offers a one-click **Install for me** -- no terminal required.
3. The same guided setup helps you connect an AI provider (Anthropic, OpenAI, Google, a local model, and more) before you start your first session.

Nothing beyond downloading and installing Hramble itself is required -- everything else happens inside the app.

### Coming from Claude Code or Cursor?

On first launch, Hramble offers a guided migration wizard that detects your existing config and history. You can also trigger it later from Settings.

### Configuration

Core configuration -- model providers, MCP connectors, custom tools, and agent behavior -- is managed through config files on OpenCode's execution engine underneath Hramble. Refer to the [OpenCode documentation](https://opencode.ai/docs) for the low-level config format; connectors and providers can also be managed from Hramble's own Settings UI.

### From source

For contributors -- if you just want to use Hramble, download a release instead (above), no Bun required.

**Prerequisites:** [Bun](https://bun.sh) 1.3.8+ and [OpenCode CLI](https://opencode.ai) (the same CLI Hramble can install for you in-app -- see above -- or install manually with `curl -fsSL https://opencode.ai/install | bash`)

```bash
git clone https://github.com/worldkingk777/hramble-code.git
cd hramble-code
bun install

# Run the Electron app
cd apps/desktop && bun run dev
```

Prefer iterating on the UI without the full Electron process running? Same prerequisites, two terminals instead of one:

```bash
# Terminal 1: Start the backend
cd apps/server && bun run dev     # port 3100

# Terminal 2: Start the renderer, browser-only, no Electron
cd apps/desktop && bun run dev:web  # port 1420
```

<br>

## Architecture

```
apps/
  desktop/       Electron 40 + Vite + React 19 desktop app
  server/        Bun + Hono backend (browser-mode dev only)
packages/
  ui/            Shared shadcn/ui component library (@hramble/ui)
  configconv/    Universal agent config converter (Claude Code, Cursor, OpenCode)
  configconv-cli/ CLI wrapper for the config converter
```

The desktop app has three runtime contexts:

- **Main process** (Node.js) -- Window management, IPC handlers, OpenCode server lifecycle, automation scheduler
- **Preload** -- Secure bridge exposing `window.hramble` API via `contextBridge`
- **Renderer** (Chromium) -- React app with components, hooks, services, and Jotai atoms

<br>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 40, electron-vite |
| Frontend | React 19, Vite 6, TypeScript |
| Styling | Tailwind CSS v4 |
| State | Jotai |
| Routing | TanStack Router |
| UI components | shadcn/ui, Base UI, cmdk |
| Code highlighting | Shiki |
| Diff rendering | @pierre/diffs |
| Virtualization | TanStack Virtual |
| AI integration | @opencode-ai/sdk |
| Monorepo | Turborepo + Bun workspaces |
| Linting | Biome |
| Packaging | electron-builder |
| Versioning | Changesets |

<br>

## Commands

```bash
# Development
bun run dev              # Electron dev mode (from apps/desktop)
bun run dev:web          # Browser-only dev mode (from apps/desktop, needs apps/server)

# Build and package
bun run build            # Production build
bun run package          # Package for current platform
bun run package:all      # Package for all platforms

# Quality
bun run lint             # Lint with Biome
bun run lint:fix         # Lint and auto-fix
bun run check-types      # Type-check all packages

# Testing
cd packages/configconv && bun test   # Run tests

# Versioning
bun changeset            # Add a changeset
bun run version-packages # Apply changesets and bump versions
```

<br>

## Contributing

Hramble is in early alpha and we welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run quality checks: `bun run lint && bun run check-types`
5. Add a changeset: `bun changeset`
6. Open a pull request

Please see the [AGENTS.md](AGENTS.md) file for code style conventions, naming patterns, and important architectural notes.

<br>

## Under the Hood

Hramble's harness, prompts, multi-agent workflows (Hyperloop), memory system, connectors, and desktop app are all our own. For model orchestration and tool execution, Hramble runs on [OpenCode](https://github.com/anomalyco/opencode) -- an open, model-agnostic execution engine -- via the [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk) package, the same way a browser might be built on an open rendering engine underneath its own UI and features.

The UI component library is built with [shadcn/ui](https://ui.shadcn.com/), [Base UI](https://base-ui.com/), and [Tailwind CSS](https://tailwindcss.com/).

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for a full list of third-party dependencies and their licenses.

<br>

## License

Hramble is source-available under the [Functional Source License 1.1](LICENSE) (Apache 2.0 future license) -- you're free to read, self-host, and modify the code for any purpose other than building a competing product or service. Each release automatically converts to the fully open Apache License 2.0 two years after its publish date.
