---
name: writing-tests
description: Write, run, and fix automated tests that actually catch bugs — unit, integration, and regression tests — matching the project's existing test setup. Use when the user asks to add tests, write a test, cover something with tests, do TDD, test-drive a feature, improve coverage, fix a failing or flaky test, or verify behavior with tests.
---

# Writing Tests

Good tests pin down real behavior and fail loudly when it breaks. A test that passes no matter what is worse than none — it gives false confidence.

## 1. Match the project's setup — never invent one

- Find the existing test runner and conventions **before writing anything**: check `package.json` scripts, `Makefile`, `pyproject.toml`/`pytest.ini`, `go.mod`, config files, and the existing test files.
- Mirror what's already there: the same runner, file naming (`*.test.ts`, `*_test.go`, `test_*.py`), directory layout, assertion style, and setup/teardown patterns. Read a neighboring test first.
- Only introduce a new framework if the project truly has none — and then prefer the language's **built-in** runner (`node --test`, `python -m unittest`/`pytest` if present, `go test`) over adding a heavy dependency. If adding a dependency is unavoidable, flag it rather than doing it silently.

## 2. Test behavior, not implementation

- Assert on **observable behavior and contracts** (inputs → outputs, side effects, errors raised) — not on private internals that will change during any refactor.
- Cover the cases that actually break code:
  - The happy path (it does the normal thing).
  - **Edge cases:** empty, null/undefined, zero, negative, boundary values, very large input, duplicates, unicode.
  - **Error cases:** invalid input is rejected the way the contract says (throws, returns an error, validation message).
- One behavior per test, with a name that says what it asserts (`returns [] for an empty list`, not `test1`). When a test fails, the name alone should tell you what broke.

## 3. Make tests deterministic

- No dependence on real time, real network, randomness, or wall-clock ordering. Inject or mock the clock, freeze randomness with a seed, stub external I/O.
- Each test sets up its own state and cleans up after — no shared mutable state that makes order matter. Order-dependence is the #1 cause of flaky suites.
- Keep fixtures small and readable; a test you can't understand at a glance won't be maintained.

## 4. TDD, when asked or when it fits

1. Write the failing test first that captures the desired behavior.
2. Run it — confirm it fails **for the right reason** (the behavior is missing, not a typo in the test).
3. Write the minimal code to make it pass.
4. Re-run — green. Then refactor with the test as your safety net.

## 5. Always run them

- Run the tests you wrote (and the surrounding suite) and confirm they pass — never hand back untested test code.
- If a test fails, read the assertion diff and fix the real cause; don't weaken the assertion to force a pass.
- When fixing a bug, add the **regression test** that reproduces it first, watch it fail, then fix the code and watch it pass.

## Anti-patterns

- Writing tests without running them.
- Asserting `toBeTruthy()`/`assert x` on things that are always truthy — a test that can't fail.
- Testing private internals so every refactor breaks the suite.
- Snapshot-testing huge blobs no one reviews.
- Weakening an assertion (`>= 0`, loosened matcher) to make a red test green.
- Introducing Jest/Vitest/pytest when the project already uses something else.
