---
name: systematic-debugging
description: Find and fix the root cause of a bug, crash, failing test, or wrong output through disciplined evidence-driven debugging instead of guess-and-check. Use when the user says something is broken, throws, crashes, errors, returns the wrong value, fails a test, behaves unexpectedly, is flaky, worked before and now doesn't, or asks you to debug, diagnose, trace, or figure out why something happens.
---

# Systematic Debugging

Fix the **cause**, not the symptom. A patch that hides a bug without explaining it is not a fix. Never guess-and-check randomly — every step should be driven by evidence.

## 1. Reproduce and pin the failure

- Get the **exact** failure first: the real error message and full stack trace, the failing input, the command that triggers it. Don't work from a paraphrase — read the actual output.
- Reproduce it deterministically. If you can't reproduce it, you can't confirm a fix. For a flaky failure, run it several times and look for what differs between pass and fail (timing, ordering, state, environment).
- Note the **expected** vs **actual** behavior precisely. "Wrong" is not a diagnosis; "returns `[]` when it should return the two matching rows" is.

## 2. Localize before you theorize

- Read the stack trace top-down to the **first frame in the project's own code** — that's usually where to start, not deep in a library.
- `grep` for the error string, the failing symbol, and every call site. Trace the data backwards from where it's wrong to where it went wrong.
- Narrow the surface: bisect the input, comment out halves, add a checkpoint at the midpoint of the suspect path. Cut the search space in half each step.
- Use read-only evidence first (`read`, `grep`, logs, `git log`/`git diff` on the suspect files). If it "worked before," `git log -p` the relevant file — a recent change is a prime suspect.

## 3. Form one hypothesis and test it specifically

- State a single, concrete hypothesis: "the value is undefined here because the config is loaded after this runs."
- Test **that** hypothesis directly — add a temporary log/assert at the exact point, or inspect the exact value. Don't change three things at once; you won't know which mattered.
- If the hypothesis is wrong, the evidence you just gathered narrows the next one. Loop. Each cycle should shrink the unknown, never wander.

## 4. Fix the root cause

- Once you can explain the full chain — *this input → this code path → this wrong state → this symptom* — fix the earliest point that is actually wrong.
- Make the **minimal** correct change. Don't refactor around the bug or "improve" unrelated code in the same edit.
- Watch for the same bug's siblings: if one call site had it, `grep` the others.

## 5. Verify and clean up

- Re-run the exact reproduction — confirm it now passes. "Should be fixed" is not "fixed."
- Run the build/typecheck/tests to confirm you didn't break a neighbor.
- Add or update a **test that would have caught this**, if the project tests such things — that's how a fixed bug stays fixed.
- **Remove every temporary log, print, or assert** you added while debugging. Leave the tree clean.

## Anti-patterns

- Changing code before you've reproduced and understood the failure.
- "Fixing" by wrapping in try/catch, adding `?.`, or silencing the error without knowing why it fired.
- Editing multiple spots at once so you can't tell what worked.
- Declaring victory without re-running the failing case.
- Leaving `console.log("HERE")` behind.
