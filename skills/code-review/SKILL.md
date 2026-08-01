---
name: code-review
description: Review a diff, pull request, commit, or file for real defects — correctness, security, and maintainability — and report findings ranked by severity with concrete evidence. Use when the user asks you to review code, review a PR or diff, check changes before commit, look for bugs or security issues, give feedback on code, or sanity-check work before it ships.
---

# Code Review

The job is to find the defects that matter and prove they're real — not to nitpick style or pad a list. A confident "this is wrong because X, and here's the input that breaks it" is worth more than ten vague suggestions.

## 1. Understand the change before judging it

- Read what actually changed: `git diff` (and `git diff --stat` for scope). For a PR, read the description to learn the intent — then check the code against that intent.
- Read enough **surrounding** code to judge the change in context: the functions it calls, its callers, the types it touches. A diff can look fine in isolation and be wrong in context.
- Know the goal: does this change do what it claims, without breaking what it touches?

## 2. Review in priority order

Spend effort where the risk is. Highest first:

1. **Correctness** — Does it do the right thing on the normal path *and* the edges? Look for: off-by-one, null/undefined, empty-collection, boundary and overflow, wrong operator (`=` vs `==` vs `===`, `&&` vs `||`), inverted conditions, unhandled error paths, race conditions, resource leaks (unclosed files/handles), incorrect async/await, mutation of shared state.
2. **Security** — Untrusted input reaching a sink: injection (SQL/command/HTML), path traversal, missing authz check, secrets committed to the repo, unsafe deserialization, missing validation on a boundary. Treat all external input as hostile.
3. **Contract & compatibility** — Breaking an API/type signature, changing behavior callers rely on, a migration that isn't backward-safe.
4. **Maintainability** — Only real issues: dead code, a genuinely confusing abstraction, duplicated logic that will drift. Not personal style preferences.
5. **Tests** — Is the new behavior covered? Would the existing tests catch a regression here?

## 3. Verify each finding — don't cry wolf

- For every issue you raise, construct the **concrete failure**: the specific input or state, and the wrong output or crash it produces. If you can't, it's a hunch — mark it as one or drop it.
- Before flagging "X is undefined here," trace whether it actually can be, given the callers. Adversarially try to prove your own finding *wrong*; report only what survives.
- Distinguish **must-fix** (breaks correctness/security) from **worth considering** (maintainability) from **nit** (style). Don't inflate a nit into a blocker.

## 4. Report clearly

- Lead with a one-line verdict: is it safe to ship, or are there blockers?
- List findings **most-severe first**. For each: the `file:line`, what's wrong, the concrete case that breaks, and the fix.
- Acknowledge what's genuinely good when it's real — but never pad with empty praise.
- If asked to *apply* fixes, fix the must-fixes, verify (build/tests), and report what you changed and what you deliberately left.

## Anti-patterns

- Style nitpicks and reformatting dressed up as a review.
- Flagging "possible" issues you didn't verify — false alarms erode trust.
- Reviewing the diff blind to its callers and context.
- A flat list that buries a security hole between two naming quibbles.
- Rubber-stamping ("LGTM") without actually tracing the risky paths.
