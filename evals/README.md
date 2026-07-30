# Hramble evals

A small, deterministic harness that measures whether a model can actually
complete real coding tasks **through Hramble's agent loop** — not just answer in
chat. Without this, "is Qwen 30B good enough?" or "did the prompt change help?"
are opinions. This turns them into a number.

## Running

```bash
# score a model across the whole suite
node evals/run.mjs --model ollama/qwen3-coder:30b

# a single task while iterating
node evals/run.mjs --model ollama/qwen3-coder:30b --only clamp-boundary

# decomposition mode: one planning turn, then execution
node evals/run.mjs --model ollama/qwen3-coder:30b --mode plan-build

# write full diagnostics to a file
node evals/run.mjs --model anthropic/claude-sonnet-5 --json out.json
```

`--model` is `<provider>/<modelID>` (the provider is everything before the first
slash; model IDs may contain slashes/colons). Requires the `opencode` CLI on
`PATH` — the harness spawns `opencode serve` per task, scoped to a clean copy of
the task's fixture.

Output is a scoreboard: `PASS`/`FAIL` per task, then totals plus **empty
replies** (model never engaged — usually rate-limiting) and **tool errors**
(agent-loop breakage). Exit code is 0 only if every task passes.

## How a task is scored

Per task the harness: copies the fixture to a temp dir → starts `opencode serve`
there → creates a session → sends the prompt → polls until the turn settles →
runs the task's verification → records pass/fail + diagnostics → cleans up.

An empty response is retried once after a back-off, because free tiers throttle
back-to-back runs and an empty reply otherwise gets mis-scored as incompetence.

## The suite (22 tasks)

Each task is a directory with a `task.json` and an optional `repo/` fixture. The
mix is deliberately broad — fixing bugs, implementing from a signature,
multi-file refactors, running commands, editing config, and building from
scratch:

| Task | Skill exercised |
|------|-----------------|
| 01 add-function | add + export without breaking existing code |
| 02 fix-failing-test | read a failing test, fix the implementation |
| 03 rename-across-files | multi-file refactor, consistency |
| 04 extract-helper | refactor / extract shared code |
| 05 read-and-report | read code, report findings to a file |
| 06 run-command | run a shell command, capture output |
| 07 html-todo-app | build a self-contained app from scratch |
| 08 landing-page | build a static page from scratch |
| 09 clamp-boundary | fix an off-by-bound edge-case bug |
| 10 async-sum | fix an async / await bug |
| 11 extract-emails | implement (regex extraction) |
| 12 group-by-category | implement (data transform / grouping) |
| 13 divide-guard | add input validation / error throwing |
| 14 dedupe | implement (order-preserving dedupe) |
| 15 flatten | implement (recursion / deep flatten) |
| 16 sort-by-field | implement (stable comparator, no mutation) |
| 17 word-count | implement (string handling, edge cases) |
| 18 fibonacci | implement (basic algorithm) |
| 19 parse-query | implement (parsing) |
| 20 merge-configs | implement (immutable object merge) |
| 21 add-npm-script | edit JSON config in place |
| 22 csv-to-json | implement (parsing structured text) |

Every fixture is dependency-free and runs offline: verification is either a
`node` command (exit 0 = pass) or a file-content check. All tasks are validated
so the starter fixture *fails* (there is real work to do) and a correct solution
*passes* (the test is fair).

## Adding a task

1. `mkdir -p evals/tasks/NN-slug/repo`
2. Write `evals/tasks/NN-slug/task.json`:
   ```json
   {
     "prompt": "Clear, self-contained instruction for the agent.",
     "verify": { "cmd": "node test.mjs" }
   }
   ```
   `verify` is either `{ "cmd": "<shell, exit 0 = pass>" }` or
   `{ "fileContains": { "file": "OUT.txt", "text": "expected" } }`.
3. Put starter files in `repo/`. Include a `test.mjs` (using `node:assert`) that
   **fails** on the starter and **passes** on a correct solution.
4. Keep it dependency-free so it runs anywhere with just `node`.
