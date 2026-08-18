# Engine Production Audit (vs Claude Code)

Five parallel adversarial reviews of `packages/engine/src`. Every finding was verified
against the code; the real ones are fixed + tested. Status: ✅ fixed · 📝 noted (deferred).

## FIXED (verified + tested)
**Security:** S1 drive-by-RCE Origin guard · S2 MCP secret-env scrub · S3 webfetch SSRF
(private/metadata block, redirect re-validation, streamed byte cap) · S4 Windows
destructive-command detection · S5 destructive-bash always prompts (chain-bypass closed) ·
S6 out-of-project reads prompt (exfil closed).
**Correctness:** C1 abort no longer orphans tool_use · C2 abort unblocks permission
prompt + clears pending · C3 `$`-mangling in edit/multiedit · C4 malformed tool JSON →
tool error · C5 OpenAI empty tool_calls omitted · C6 atomic writes (files + store) ·
C7 store boot-crash guard + corrupt-file backup.
**Robustness:** M1 sub-agent read-only tools · M2 MCP timeouts/leaks/race · M3 checkpoint
+ redo cleanup (compact/delete) · M4 permission timer cleanup · M5 /find restricted to
projects · M6 webfetch download cap · M7 bash maxBuffer/timeout labels · M8 summarize
head+tail + retry · M9 read size guard + binary detection · L1 nbformat cell id · L2 glob
exclude merges defaults.

## ✅ Post-audit capability additions (toward Claude parity)
- **Prompt caching** (Anthropic): system prompt + tool schemas + conversation prefix
  are cache-marked (3 breakpoints) so multi-step loops only pay for new tokens.
- **Background shells**: `bash` run_in_background + `bashoutput` + `killshell`
  (Claude-style) for dev servers/watchers; Windows tree-kill; drained on shutdown.
- **Auto-compaction**: near ~80% of the context window, older turns are summarized
  into one message (current turn preserved) instead of silently trimmed.
- **Image vision**: image attachments (png/jpeg/gif/webp, ≤5MB) now flow as real
  vision blocks in the user message, serialized to Anthropic + OpenAI shapes.
- **M10** grep ReDoS: fallback validates the regex, caps per-line probe length,
  and stops at an 8s deadline. ✅
- **M13** iteration limit: emits a notice when a turn hits MAX_ITERATIONS with tool
  calls still pending, instead of stopping silently. ✅

## 📝 Noted / deferred (design decisions, not blocking)
- **S7** malicious-repo prompt injection via CLAUDE.md/AGENTS.md/skills — trusted by
  design (Claude Code trusts project files too); consider opt-in loading for untrusted repos.
- **S2 (residual)** repo `.hramble/mcp.json` still auto-spawns its command (secrets scrubbed).
  Full fix: user must approve MCP servers (add during cutover UI).
- **M7 (residual)** bash timeout doesn't kill the whole process tree (backgrounded children
  survive) — needs OS-specific tree-kill; low risk for local single-user.
- **M10** grep Node-fallback ReDoS (only when ripgrep absent) — add a line-length/time guard.
- **M11** azure/vertex/bedrock/cloudflare providers are non-functional as shipped (blank
  baseURL / non-bearer auth) — remove from the catalog or gate as "needs config" (product decision).
- **M12** SSE broadcasts all sessions to every client — irrelevant for single-user local +
  now behind the Origin guard; add per-session filtering if multi-user.
- **Storage** ✅ moved flat-JSON store → SQLite (`node:sqlite`, WAL, indexed, transactional;
  auto-migrates any existing sessions.json). Incremental row writes replace whole-file
  rewrites. Note: node:sqlite is experimental in Node 24 (benign boot warning); chosen over
  better-sqlite3 to avoid native-module packaging in Electron.
- Low: L3 PATH prepend order, L4 tiny-window last-2 rule, L5 token-estimate overhead, L6 data:-URL
  attachment cap, L7 unknown-tool default-allow, L8 explicit request-size/rate limits.

---
_Original findings (verified against code) below._

## CRITICAL — Security

## CRITICAL — Security
- ⬜ **S1. Open CORS + no auth → any webpage can drive the engine (RCE).** `server.ts` sets `ACAO:*` + PNA, no Origin check, no token; binds 127.0.0.1 but a browser can still cross-origin `POST /prompt` (auto mode) → bash/file tools. Fix: require a per-run auth token and/or Origin allow-list (localhost/app only).
- ⬜ **S2. Repo `mcp.json` auto-spawns arbitrary commands with full env.** `mcp.ts` reads `<dir>/.hramble/mcp.json` on first prompt and spawns `command` with all `process.env` (secrets). Cloning a malicious repo = RCE + secret leak. Fix: MCP servers must be user-approved, not auto-trusted from repo config; scrub env.
- ⬜ **S3. SSRF in webfetch.** No host/IP filtering; reaches `169.254.169.254` (cloud metadata), `localhost`, private IPs; redirects not re-checked. Fix: block loopback/private/link-local/metadata; re-validate on redirect.
- ⬜ **S4. Windows destructive-command detection blind.** `isDangerous` is Unix-only; `del /s /q`, `rd /s /q`, `format` run unprompted in auto. Fix: add Windows patterns.
- ⬜ **S5. permissionKey bash over-match + chain bypass.** Key = first token → `bash:npm` allows `npm … && rm -rf`; chaining behind any allowed binary skips the destructive gate. Fix: don't offer "always" for chained/destructive commands; key more strictly.
- ⬜ **S6. Out-of-project reads never prompt → silent secret exfil.** read/attachments resolve absolute/`..` paths, `read` in NEVER_PROMPT. Fix: prompt for out-of-project reads (except bypass) with "always allow"; keep UI-attached files unprompted. (Reverses the earlier reads-never-prompt; security > one prompt. Design note for user.)
- 📝 **S7. Malicious-repo prompt injection via CLAUDE.md/AGENTS.md/skills.** Injected as trusted, precedence-taking. Claude Code trusts project files too; largely by design. Consider opt-in loading for untrusted repos.

## CRITICAL — Correctness
- ⬜ **C1. Abort mid-tool orphans tool_use → bricks session.** Assistant msg with N tool_use persisted, but abort persists <N tool_results → next request 400s forever. Fix: back-fill synthetic "interrupted" tool_result for every pending tool_use; don't persist empty results.
- ⬜ **C2. Abort during permission prompt hangs 5min + delayed mutation + concurrent runs.** Signal not wired to the permission await; pendingPermissions not cleared; no signal re-check before executeTool. Fix: reject pending permission on abort, clear it, re-check aborted.
- 🔧 **C3. `$`-mangling in edit/multiedit.** Non-replaceAll path uses `content.replace(old,new)` → `$&`,`$1`,`$$` in newString corrupt output. Fix: literal split/join.
- ⬜ **C4. Malformed tool-input JSON kills the whole turn.** `JSON.parse(inputJson)` outside try → session flips to error. Fix: catch, return tool error to model.
- ⬜ **C5. OpenAI empty `tool_calls: []` rejected by many gateways.** Text-only assistant history msg emits `tool_calls: []`. Fix: include only when non-empty.
- ⬜ **C6. Non-atomic writes (store + file tools).** Full-file `writeFileSync`/`writeFile` → crash mid-write corrupts. Fix: temp + rename (+ fsync) for persist and write/edit/multiedit/notebook.
- ⬜ **C7. initDb missing `store.sessions` guard → boot crash; parse failure silently wipes all history.** Fix: guard sessions, and on parse failure back up the bad file instead of silent reset.

## HIGH / MEDIUM
- ⬜ **M1. runSubAgent offers full tools despite plan mode** (doesn't pass read-only tools) → wasted iterations, risk gated only by name check. Fix: pass SUBAGENT tools.
- ⬜ **M2. MCP calls/connect have no timeout → a hung server wedges the turn forever;** partial-connect leaks child processes; cache-before-await race returns empty tools. Fix: timeouts, leak cleanup, connect fully before caching.
- ⬜ **M3. Checkpoint/redo leaks:** compactSession/deleteMessage/forkSession don't clean/copy checkpoints+redo → stale diffs, orphaned snapshots, forks lose undo. Fix cleanup + fork copy.
- ⬜ **M4. Permission auto-reject timers never cleared** (leak). Fix: store + clearTimeout on resolve.
- ⬜ **M5. `/find` reads any directory + globs whole tree into memory** (disclosure + DoS). Fix: restrict to session dirs, cap.
- ⬜ **M6. webfetch buffers entire response before capping** (OOM). Fix: stream + abort at byte cap.
- ⬜ **M7. bash timeout doesn't kill process tree;** backgrounded children survive; maxBuffer mislabeled as timeout. Fix: kill tree; distinguish errors.
- ⬜ **M8. summarize is unabortable, unretried, drops the user's original goal** (tail-only). Fix: signal + retry + keep head&tail.
- ⬜ **M9. read loads whole file regardless of limit; binary/image = mojibake** (no image support). Fix: size guard + binary detection.
- ⬜ **M10. grep Node fallback ReDoS (no timeout).** Fix: guard/timeout.
- ⬜ **M11. Broken providers (azure/vertex/bedrock/cloudflare) with blank baseURL** → opaque failures. Fix: remove or mark unsupported.
- ⬜ **M12. SSE broadcasts every session's events to every client** (privacy). Fix: per-session filtering.
- ⬜ **M13. MAX_ITERATIONS=50 truncates silently.** Fix: emit a limit signal.

## LOW / polish
- ⬜ L1 notebook cells lack nbformat `id`. ⬜ L2 glob `exclude` replaces defaults. ⬜ L3 PATH prepends user-writable dirs ahead of System32. ⬜ L4 trimHistory can exceed a tiny window (last-2 rule). ⬜ L5 estimateTokens counts JSON overhead. ⬜ L6 data:-URL attachment decoded before cap (DoS). ⬜ L7 checkPermission default-allow for unknown tools. ⬜ L8 request size/rate limits not explicit. ⬜ L9 dead code (MESSAGES_FILE, bash `directory` param).

## Verified OK (no fix)
Boot reconciliation resets running→idle correctly; retry duplication guard is sound; abortable sleep; recursion prevention (task not in subagent set); snapshotting covers all 4 write tools; permission-check path == executed path; auth.ts doesn't log keys; instructions/memory/skills are directory-scoped (no cross-project leak); webfetch restricts to http/https.
