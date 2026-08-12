/**
 * Auto-registers the Hramble session MCP server in the OpenCode config.
 *
 * The MCP server (`session-mcp.cjs`) exposes `list_sessions` and
 * `send_to_session` tools so the AI can coordinate across open sessions
 * without any manual setup by the user.
 *
 * Config file: ~/.config/opencode/opencode.jsonc  (JSONC, same file as connectors)
 * Script path: <resourcesPath>/session-mcp.cjs   (bundled via extraResources)
 */

import fs from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { createLogger } from "./logger"

const log = createLogger("session-mcp")

const CONFIG_PATH = path.join(homedir(), ".config", "opencode", "opencode.jsonc")
const MCP_NAME = "hramble-sessions"

function getScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "session-mcp.cjs")
  }
  // Dev: out/main/ → ../../resources/
  return path.resolve(__dirname, "../../resources/session-mcp.cjs")
}

/** Strip // and /* *​/ comments so JSONC parses as JSON. */
function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function readConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8")
    return JSON.parse(stripJsonComments(raw))
  } catch {
    return {}
  }
}

function writeConfig(cfg: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8")
}

/**
 * Writes the hramble-sessions MCP entry to opencode.jsonc.
 * No-ops if the entry already exists with the same command to avoid
 * clobbering user edits on every launch.
 */
export function registerSessionMcp(): void {
  try {
    const scriptPath = getScriptPath()
    if (!fs.existsSync(scriptPath)) {
      log.warn("session-mcp.cjs not found, skipping MCP registration", { scriptPath })
      return
    }

    const cfg = readConfig()
    const mcp = (cfg.mcp as Record<string, unknown> | undefined) ?? {}
    const existing = mcp[MCP_NAME] as { command?: string[] } | undefined
    const command = ["node", scriptPath]

    if (existing && JSON.stringify(existing.command) === JSON.stringify(command)) {
      log.debug("session-mcp already registered, no change needed")
      return
    }

    cfg.mcp = { ...mcp, [MCP_NAME]: { type: "local", command, enabled: true } }
    writeConfig(cfg)
    log.info("session-mcp registered", { scriptPath })
  } catch (err) {
    log.error("Failed to register session-mcp", err)
  }
}
