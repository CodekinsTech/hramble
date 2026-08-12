#!/usr/bin/env node
/**
 * Hramble Session MCP Server (stdio transport)
 *
 * Provides `list_sessions` and `send_to_session` tools to the AI.
 * OpenCode spawns this as a child process and communicates via JSON-RPC
 * over stdin/stdout (MCP stdio protocol).
 *
 * Reads the OpenCode server port from ~/.local/share/hramble/server.lock
 * (XDG_DATA_HOME/hramble/server.lock) and calls the OpenCode HTTP API.
 */

"use strict"

const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const readline = require("readline")

// ─── Server port discovery ─────────────────────────────────────────────────

function getLockfilePath() {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(xdgData, "hramble", "server.lock")
}

function getServerPort() {
  try {
    const raw = fs.readFileSync(getLockfilePath(), "utf8")
    const data = JSON.parse(raw)
    return typeof data.port === "number" ? data.port : 4101
  } catch {
    return 4101
  }
}

// ─── HTTP helper ───────────────────────────────────────────────────────────

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const port = getServerPort()
    const bodyStr = body != null ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: bodyStr
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
          : {},
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => { data += chunk })
        res.on("end", () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ _raw: data }) }
        })
      },
    )
    req.on("error", reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ─── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_sessions",
    description:
      "List all open Hramble coding sessions. Returns each session's ID, title, and working directory. Use this to find a target for send_to_session.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "send_to_session",
    description:
      "Send a message into another open Hramble session. The AI in that session receives it as a user prompt and responds. Use this to coordinate work, delegate tasks, or check for overlap across sessions.",
    inputSchema: {
      type: "object",
      required: ["session_id", "message"],
      properties: {
        session_id: {
          type: "string",
          description: "The session ID from list_sessions",
        },
        message: {
          type: "string",
          description: "The message to inject into that session's AI context",
        },
      },
    },
  },
]

// ─── Tool implementations ─────────────────────────────────────────────────

async function callTool(name, args) {
  if (name === "list_sessions") {
    try {
      const sessions = await apiRequest("GET", "/session?limit=50")
      const list = Array.isArray(sessions) ? sessions : []
      if (list.length === 0) return "No open sessions found."
      return list
        .map((s) => {
          const lines = [`ID: ${s.id}`]
          if (s.title) lines.push(`Title: ${s.title}`)
          if (s.project || s.cwd) lines.push(`Project: ${s.project || s.cwd}`)
          return lines.join("\n")
        })
        .join("\n\n")
    } catch (err) {
      return `Error listing sessions: ${err.message}`
    }
  }

  if (name === "send_to_session") {
    const { session_id, message } = args || {}
    if (!session_id || !message) return "Error: session_id and message are required."
    try {
      await apiRequest("POST", `/session/${session_id}/prompt_async`, {
        parts: [{ type: "text", text: message }],
      })
      return `Message sent to session ${session_id}. The AI in that session will respond shortly.`
    } catch (err) {
      return `Error sending message: ${err.message}`
    }
  }

  return `Unknown tool: ${name}`
}

// ─── MCP stdio protocol ───────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false })

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n")
}

rl.on("line", async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try { msg = JSON.parse(trimmed) }
  catch { return }

  const { jsonrpc, id, method, params } = msg

  if (method === "initialize") {
    send({
      jsonrpc,
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hramble-sessions", version: "1.0.0" },
      },
    })
  } else if (method === "notifications/initialized") {
    // no response needed
  } else if (method === "tools/list") {
    send({ jsonrpc, id, result: { tools: TOOLS } })
  } else if (method === "tools/call") {
    const { name, arguments: toolArgs } = params || {}
    try {
      const text = await callTool(name, toolArgs || {})
      send({ jsonrpc, id, result: { content: [{ type: "text", text }] } })
    } catch (err) {
      send({
        jsonrpc,
        id,
        result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true },
      })
    }
  } else {
    // Unknown method — respond with empty result if a reply is expected
    if (id != null) send({ jsonrpc, id, result: {} })
  }
})
