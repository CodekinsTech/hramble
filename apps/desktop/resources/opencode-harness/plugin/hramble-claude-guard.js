// Hramble Claude-guard — enforces Claude-Code-style output discipline for EVERY
// model (including weak ones like GLM that ignore prompt rules).
//
// It blocks, before they run, the two shell anti-patterns that break the
// interface feel:
//   1. Writing file CONTENT via the shell (heredocs, `cat >`, `tee`, `echo/printf
//      > file.ext`). These dump the entire file into the chat. The agent must use
//      the `write`/`edit` tools instead (they render as a clean, collapsible diff).
//   2. Opening a local page in a browser from the shell (`open`/`xdg-open`/`start`
//      an .html/.svg or file:// , or `open -a <browser>`). The agent must use the
//      `preview` tool, which serves the page on a local http server and opens it
//      in the browser the user sees — the way Claude Code previews.
//
// Detection is high-precision: everyday shell (git, npm, ls, grep, build, mkdir,
// mv/cp, `curl > data.json`, `cmd > out.log`, `> /dev/null`) is NOT blocked.

// Source/content file extensions that indicate "writing code", not a data/log dump.
const SRC_EXT =
	"html?|svg|jsx?|tsx?|mjs|cjs|css|scss|less|vue|astro|md|mdx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|php|sh|bash|zsh|yml|yaml|toml|xml|sql|graphql|gql|prisma"

// --- file-write-via-shell patterns (dump code into chat) ---
const HEREDOC = /<<[-~]?\s*['"]?[A-Za-z_][A-Za-z0-9_]*\b/ // << EOF, <<-'EOF' (NOT the <<< herestring)
const CAT_REDIR = /\bcat\s*>>?/ // cat > file / cat >> file
const ECHO_WRITE = new RegExp(
	String.raw`\b(?:echo|printf)\b[^\n]*?>>?\s*['"]?[^\s>|&;'"]+\.(?:${SRC_EXT})\b`,
	"i",
)
const TEE_WRITE = new RegExp(String.raw`\btee\b\s+(?:-a\s+)?['"]?[^\s|&;'"]+\.(?:${SRC_EXT})\b`, "i")
const REDIR_SRC = new RegExp(String.raw`>>?\s*['"]?[^\s>|&;'"]+\.(?:${SRC_EXT})\b`, "i") // > file.js etc.

// --- open-in-browser-via-shell patterns (should use the preview tool) ---
const OPEN_FILE = /\b(?:open|xdg-open|start)\b[^\n]*(?:file:\/\/|\.(?:html?|svg)\b)/i
const OPEN_BROWSER_APP =
	/\bopen\s+-a\s+['"]?(?:Google Chrome|Google Chrome Canary|Safari|Firefox|Chromium|Microsoft Edge|Brave Browser|Arc)\b/i

function classify(command) {
	const cmd = String(command || "")
	if (!cmd.trim()) return null

	if (HEREDOC.test(cmd) || CAT_REDIR.test(cmd) || ECHO_WRITE.test(cmd) || TEE_WRITE.test(cmd) || REDIR_SRC.test(cmd)) {
		return {
			kind: "file-write",
			msg:
				"Blocked: do not write files with the shell (cat/echo/printf/tee/heredoc/redirection) — it dumps the whole file into the chat. " +
				"Use the `write` tool to create a file or `edit` to change one; they render as a clean, collapsible diff the user can review. Retry with `write`/`edit`.",
		}
	}
	if (OPEN_FILE.test(cmd) || OPEN_BROWSER_APP.test(cmd)) {
		return {
			kind: "browser-open",
			msg:
				"Blocked: do not open pages in a browser from the shell (open/xdg-open/start/file://). " +
				"Use the `preview` tool — it serves the page on a local http server and opens it in the browser the user sees (so relative assets, modules, and fetch work). Retry with `preview`.",
		}
	}
	return null
}

export default async () => ({
	"tool.execute.before": async (input, output) => {
		if (input?.tool !== "bash") return
		const hit = classify(output?.args?.command)
		if (hit) {
			// Throwing stops the tool and hands the reason back to the agent, which
			// then retries with the correct tool (write/edit or preview).
			throw new Error(`[Hramble] ${hit.msg}`)
		}
	},
})
