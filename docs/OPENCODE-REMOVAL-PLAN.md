# OpenCode Removal & Engine Cutover — Roadmap

> **Progress:** Phase 0 (discovery + boot reconciliation ✅), Phase 1 (session
> lifecycle incl. summarize + revert/unrevert w/ file rollback ✅), Phase 2
> (providers/config UI ✅), Phase 3 (once/always/reject permissions + persisted
> allow-list ✅), Phase 4 (plan mode, hard-enforced read-only + agent selection ✅;
> file attachments deferred). Remaining: 4-attachments, 5–10.
> Engine features are verified against live models each phase; renderer wiring is
> typecheck-only and keeps OpenCode as a fallback, so nothing breaks in transition.
> Audit has already caught + fixed real bugs (redo-clear, revert-during-run,
> orphan tool pairs, plan-mode enforcement).

Goal: make the local **engine** (`packages/engine`, port 4200) the app's *only* backend, then
delete OpenCode entirely (the `@opencode-ai/sdk` dependency, `opencode-manager`, the bundled
harness, and the `opencode-plugins`). Once the app no longer runs OpenCode, there is genuinely
nothing to recognize as OpenCode and the third-party attribution can be dropped legitimately.

Principle: **grow the engine to parity on a capability → flip the app to the engine for it →
delete the OpenCode code for it.** Never delete before the replacement is live. The app stays
working after every phase.

Current state: chat/prompt/create-session/abort/permission already route to the engine when
`engineConnectedAtom` is true (`use-server.ts`). Everything else is OpenCode-only.

---

## Classification

### Keep (retarget only — no rebuild)
- `packages/configconv` — one-time config *import* tool, not runtime. Repoint migration target
  off `{ to: "opencode" }`; drop/retarget the OpenCode history writer. Keeps Claude Code / Cursor
  import.
- `apps/desktop/src/main/git-service.ts` — native git is done in the main process, backend-independent.

### Delete outright (no parity rebuild needed)
- OpenCode CLI detect/install: `main/compatibility.ts`, onboarding **Environment Check** step.
- `opencode.template.json`, `harness-installer.ts`, `resources/opencode-harness/` (~1.3M).
- Chromium plain-HTTP workarounds for the `:4101` server (`index.ts` HttpsUpgrades / insecure-localhost / PNA).
- `opencode:` IPC handlers + preload wiring, once nothing calls them.
- `@opencode-ai/sdk` deps (desktop, engine, configconv, apps/server) — last.

### Rebuild-then-delete (engine must reach parity first)
- Session lifecycle: list+pagination+search, status map, messages, rename, delete, fork,
  summarize/compact, revert/unrevert, delete-part.
- Discovery APIs: providers, models, config (default model/agent/compaction), agents, commands.
- Structured **questions** (asked/reply/reject) + richer permissions ("once"/"always"/"reject", persisted allow-list).
- Prompt richness: file attachments, agent selection (plan vs build), plan-mode two-turn, variant.
- VCS/find/diff: `find.files`, `session.diff`; worktrees create/list/remove/reset.
- Automation executor (`main/automation/executor.ts`) + tray (`main/tray.ts`) — both call the SDK directly.
- The 17 harness plugins' features (see Phase 5).

---

## Phases

### Phase 0 — Engine hardening for sole-backend duty (prerequisite)
The engine is fine as a parallel chat, but not yet safe as the *only* backend.
- Replace flat-JSON store (rewritten every message) with **SQLite**; add migrations + indices.
- Reconcile state on boot (orphaned "running" sessions → idle); persist active-run/permission state.
- Scope SSE per-session (today every client gets every event); add optional auth for remote use.
- Expose **discovery over HTTP**: `getAllProviders`/`getModel` already exist internally but no endpoint.
- Wire dynamic baseURL for Azure/Vertex/Bedrock/Cloudflare (listed but broken), or drop them.

### Phase 1 — Session lifecycle parity
Engine endpoints: `GET /sessions` (limit/roots/search), session status, `GET /sessions/:id/messages`,
rename, delete, fork, summarize, revert/unrevert, delete-part. Then route the OpenCode-only branches
in `use-server.ts` (renameSession, deleteSession, deletePart, revert, unrevert, forkSession, summarize)
and session listing/pagination in `connection-manager.ts` to the engine. Delete those OpenCode calls.

### Phase 2 — Providers / models / config / agents / commands
Engine HTTP: providers catalog (+connected/default), auth methods, config get, agents list
(build/plan/general), commands list + run. Rewire `use-opencode-data.ts`, `provider-setup-step.tsx`,
and model-state IPC (`~/.local/state/opencode/model.json` → engine store). Delete `use-opencode-data` OpenCode calls.

### Phase 3 — Questions + permissions
Engine: `question.asked/reply/reject` events + endpoints; permission "once/always/reject" with a
persisted per-project allow-list. Rewire `replyToQuestion`/`rejectQuestion`/`respondToPermission`,
unify engine permissions into the main permission atoms. Delete OpenCode question/permission paths.

### Phase 4 — Prompt richness
Engine prompt accepts file parts, `agent` (plan/build), plan-mode two-turn, variant. Restore the
features the engine path currently drops (files, plan-mode, Hyperloop-equivalent). Then the engine
fully backs the prompt path; delete the OpenCode prompt branch in `use-server.ts`.

### Phase 5 — Harness plugins → engine-native features (largest)
Rebuild each as an engine capability (needs engine sub-agent/session APIs from Phases 1–4):
- **workflow** (parallel + pipeline sub-agents), **tasks** (detached background jobs), **schedule**
  (delayed wakeup), **monitor** (watch→wake) — all need programmatic session create/promptAsync/abort.
- **memory** (project+global markdown, recall, past-session search over the store), **skills**
  (SKILL.md create/register + Brain catalog/registry).
- **browser / artifact / preview** — the in-app browser bridge + static preview server.
- **notify** (OS notifications), **messages** (agent-to-agent inbox), **notebook** (.ipynb cell edit),
  **leanprompt** (model-aware system prompt), **hooks** (user pre/post-tool shell hooks).
- **safety** + **claude-guard** (command/output guards) — fold into the engine permission/guard layer.
- **repomap** (cross-file symbol graph + cache).
Then delete `opencode-plugins/` and `resources/opencode-harness/plugin/`.

### Phase 6 — VCS / find / diff + worktrees
Engine: `find.files`, `session.diff`, worktree create/list/remove/reset + ready/failed events.
Rewire `worktree-service.ts`, diff views, file search. Delete OpenCode worktree/diff/find calls.

### Phase 7 — Automation executor + tray
Rewrite `main/automation/executor.ts` and `main/tray.ts` off `@opencode-ai/sdk` onto the engine
(sessions/prompt/abort/permission/question). Delete `main/automation/opencode-client.ts`.

### Phase 8 — Onboarding decouple
Replace Environment Check (OpenCode CLI detect/install) with an engine health/setup check. Repoint
Provider Setup off the OpenCode-Zen-centric flow to engine providers. Retarget configconv migration
target off `"opencode"`; drop/retarget the OpenCode history writer. Delete `compatibility.ts`.

### Phase 9 — Delete OpenCode
Remove `opencode-manager.ts`, `harness-installer.ts` + `resources/opencode-harness/`,
`opencode-plugins/`, the `opencode:` IPC handlers + preload, the Chromium `:4101` workarounds,
`opencode.json`. Migrate the SDK type barrel (`renderer/lib/types.ts`) to engine-native types
(highest fan-out — do carefully). Remove `@opencode-ai/sdk` from all package.json. Update
`THIRD-PARTY-NOTICES.md` (drop the OpenCode section) and README.

### Phase 10 — Rebrand
Rename product across UI/docs/config; remove residual `opencode` identifiers in strings, paths
(`~/.config/opencode`, `~/.local/share/opencode`), env vars (`OPENCODE_CONFIG_DIR`), and settings keys.

---

## Suggested order to start
Phase 0 (engine hardening: SQLite + discovery endpoints + boot reconciliation) → Phase 1 (session
lifecycle). These make the engine safe to carry real load and unlock everything downstream. Each is
independently shippable and testable against the running app.
