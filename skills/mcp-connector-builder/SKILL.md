---
name: mcp-connector-builder
description: Build a new MCP server so a Hramble agent can call a service that doesn't already have a connector. Use when the user asks to "connect X," wants an agent to talk to a third-party API that isn't in Settings → Connectors, or asks how to build their own MCP tool. Do NOT use this to configure an existing connector (that's Settings → Connectors) — only when no preset exists yet and one needs to be written.
metadata:
  inspiration: Adapted from Anthropic's mcp-builder skill (github.com/anthropics/skills, Apache-2.0), rewritten for OpenCode/Hramble's connector model
  version: "1.0.0"
---

# MCP Connector Builder

Hramble's "Connect your tools" system (Settings → Connectors, and the per-agent
Connect cards) is just OpenCode's `mcp` config block — any MCP server that
speaks stdio or streamable-HTTP/SSE works. When a user wants an agent to talk
to a service with no existing preset, build one instead of trying to fake it
with raw HTTP calls in the agent's own code — a real MCP server is reusable
across every session and every agent, not a one-off script.

## When a connector is actually the right call

Skip this and just use `webfetch`/`bash` directly if the task is a single
one-off request to a public API with no auth. Build a connector when: the
service needs credentials that should persist across sessions, the same
service will be called repeatedly, or multiple tools/actions on that service
are needed (not just one GET request).

## Process

### 1. Scope the tools before writing code

List the actual operations the agent needs — not full API coverage. A
connector with 4 well-named tools (`stripe_list_charges`,
`stripe_create_refund`, …) beats one with 40 half-documented ones. Prefix
tool names with the service (`github_*`, `stripe_*`) so they're
distinguishable once installed alongside other connectors.

For each tool, decide:
- **Input**: what parameters, with real constraints (not just `string`) and
  one example value in the description.
- **Output**: return both a short text summary and structured data where the
  SDK supports it — the agent reads the summary, code that chains calls reads
  the structured part.
- **Side effects**: mark destructive/write operations clearly in the tool's
  own description ("Refunds a charge — cannot be undone") so the agent (and
  Hramble's permission system) treats it with appropriate caution.

### 2. Build it

TypeScript + the official `@modelcontextprotocol/sdk` is the safest default —
it's what every existing Hramble preset in `connectors.ts` already uses via
`npx -y <package>`, so a new connector slots into the same install path with
zero extra plumbing. Use stdio transport for a local server (the common
case); only reach for streamable-HTTP if the service is something users
self-host and connect to remotely (like the `stitch` or `cloudflare`
presets already do).

Minimum viable structure:
```
my-connector/
  package.json       # bin entry so `npx -y my-connector` works
  src/index.ts        # server setup + tool registration
```

Register each tool with a Zod schema for input validation, a clear
`description`, and a handler that does real error handling — an error
message like `"401: check MY_SERVICE_API_KEY is set"` is far more useful to
the agent than a raw stack trace.

### 3. Wire it into Hramble

Don't hand-edit `~/.config/opencode/opencode.jsonc` — use the same path a
user would: Settings → Connectors → Custom (advanced), name + command
(`npx -y my-connector`). For a connector that needs an API key, that's
exactly what the `envKey`-style presets already model in
`apps/desktop/src/main/connectors.ts` — if this is going to be reusable
beyond one project, add it as a real preset there instead of leaving it
custom-only, following the existing `PRESETS` entries as a template.

### 4. Test before calling it done

Run `npx @modelcontextprotocol/inspector` against the server directly first
— confirm tool schemas and a real call succeed outside of Hramble entirely.
Only after that, restart OpenCode (Settings → Connectors → "Restart now")
and exercise it from an actual agent session. A connector that works in the
Inspector but not from the agent is almost always a tool-description
problem, not a code problem — the agent picked the wrong tool or wrong
arguments because the description didn't make the right call obvious.
