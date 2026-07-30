# Hooks

Run your own shell commands automatically around the agent's tool calls — like
Claude Code's `PreToolUse` / `PostToolUse` hooks. Use them to log activity, run a
formatter after edits, notify yourself, or **block** a tool from running.

Hooks are loaded by the `hramble-hooks` plugin from:

```
~/.config/opencode/hramble-hooks.json
```

The file is re-read on every tool call, so edits take effect **without a
restart**.

## Format

A JSON array of hook objects:

```json
[
  {
    "event": "PostToolUse",
    "tool": "edit",
    "command": "npx biome format --write \"$PWD\" >/dev/null 2>&1"
  },
  {
    "event": "PreToolUse",
    "tool": "bash",
    "command": "echo \"$HRAMBLE_ARGS\" >> ~/hramble-bash.log"
  },
  {
    "event": "PreToolUse",
    "tool": "webfetch",
    "command": "grep -q allowed-hosts ~/.hramble-allow || exit 1",
    "blocking": true
  }
]
```

| Field | Meaning |
|-------|---------|
| `event` | `"PreToolUse"` (before a tool runs) or `"PostToolUse"` (after) |
| `tool` | Optional. Tool name to match — `"bash"`, `"edit"`, … Omit or `"*"` = every tool. `*` wildcards allowed (`"web*"`). |
| `command` | Shell command, run via `/bin/sh -c`. |
| `blocking` | `PreToolUse` only. If the command exits **non-zero**, the tool is **blocked** and the agent is told why. |
| `timeout` | Milliseconds before the command is killed (default `10000`). |

## Environment variables

Each command runs with:

| Variable | Value |
|----------|-------|
| `HRAMBLE_EVENT` | `PreToolUse` or `PostToolUse` |
| `HRAMBLE_TOOL` | the tool name (`bash`, `edit`, …) |
| `HRAMBLE_ARGS` | JSON of the tool's arguments |
| `HRAMBLE_OUTPUT` | (PostToolUse only) JSON of the tool result |

## Notes

- **Blocking hooks are a hard gate** — a non-zero `PreToolUse` hook stops the
  tool even in Bypass mode. This is separate from the permission modes (which
  decide when to *ask*) and the safety backstop (which blocks catastrophic
  commands).
- Hooks run your own shell commands — only add commands you trust.
- A future release will add a Settings → Hooks panel to edit this file visually;
  for now it's edited directly.
