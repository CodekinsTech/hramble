# Cloud / Platform Tools — Roadmap

The remaining tools Claude Code has that Hramble doesn't yet. Each is specced so it
can be built the moment its prerequisite exists — capability first, then the tool
(never a broken stub in the agent's toolset).

**Key insight:** these are about *where/how the agent runs*, not about the model. An
online API model (Claude/Groq) is a cloud **brain**; these need a cloud/app **agent
runtime**. But API models pair well with a cloud runtime — the server just calls the
model API (no GPUs needed). And several of these can be built **locally**, no cloud
required — noted below.

Legend: 🟢 local-buildable (no cloud) · 🔵 needs a cloud backend

---

## 🟢 workflow — deterministic multi-agent orchestration
**Purpose:** run a script that fans out several agents (parallel attempts, pipeline
stages, find→verify) and combines the results — for big/comprehensive jobs.
**Needs:** nothing new — builds on the **background-tasks** plugin already shipped
(`spawn_task`), plus a small orchestration runner that can spawn N sessions, await
them, and pass results between stages.
**Wire-in:** an OpenCode plugin `workflow` tool that runs a JS-defined fan-out over
`client.session.create/promptAsync/messages`. Local, no cloud.
**Priority:** High — biggest capability jump, and fully local.

## 🟢 monitor — watch a condition, re-invoke on change
**Purpose:** watch a file, a URL, a CI run, or a command's output, and wake the agent
when it changes/completes.
**Needs:** a persistent watcher in the Electron **main process** (the app is already
long-running) + an IPC/HTTP bridge (same pattern as the browser bridge).
**Wire-in:** plugin `monitor(target, condition)` → registers a watcher in main →
fires a follow-up prompt when the condition is met.
**Priority:** Medium — local, pairs with background tasks.

## 🟢 schedule_wakeup — resume a task later (one-shot)
**Purpose:** schedule the agent to pick a task back up at a specific time (a one-shot
version of cron).
**Needs:** nothing new — reuse the existing **Automations scheduler**
(`main/automation/scheduler.ts`, rrule-based). A wakeup = a one-time automation.
**Wire-in:** plugin `schedule_wakeup(when, prompt)` → creates a one-shot automation
via the automation API bridge.
**Priority:** Medium — local, reuses shipped infra.

## 🟢/🔵 push_notification — notify the user when something happens
**Purpose:** tell the user (desktop and/or phone) when a task finishes or needs input.
**Needs (desktop): 🟢 local** — the app already has `main/notifications.ts`; just
expose it as a tool. **Needs (phone): 🔵** the mobile companion app + a push service
(APNs/FCM) — see the mobile-companion plan.
**Wire-in:** plugin `notify(message)` → desktop notification now; routes to phone push
once the mobile companion exists.
**Priority:** Desktop = quick local win. Phone = with the mobile companion.

## 🔵 remote_trigger — run an agent job in the cloud
**Purpose:** launch an agent job on a **cloud server** so it runs even when the user's
machine is off / closed. The foundation for "real" cloud.
**Needs:** a hosted **agent runtime** — a server running opencode with session storage,
auth, and a job queue. **Pairs perfectly with API models** (the server calls
Claude/Groq's API — no GPUs to host). This is the big infrastructure piece.
**Wire-in:** plugin `remote_trigger(prompt)` → POSTs to the cloud runtime's job API →
returns a remote job id; status/results synced back to the app.
**Priority:** The gateway to the cloud platform — build this backend first; the rest of
the 🔵 tools build on it.

## 🔵 send_message — agent-to-agent messaging
**Purpose:** let agents/sessions message each other to coordinate (agent teams).
**Needs:** a shared message bus + a multi-agent runtime (naturally lives on the cloud
runtime from `remote_trigger`, or a local shared store for same-machine agents).
**Wire-in:** plugin `send_message(target, message)` over the bus; recipients read their
inbox.
**Priority:** After `remote_trigger` — it's the coordination layer for agent teams.

---

## Suggested build order
1. **workflow** (🟢, high value, local — on background tasks)
2. **push_notification (desktop)** (🟢, quick — reuse notifications.ts)
3. **schedule_wakeup** (🟢, reuse the Automations scheduler)
4. **monitor** (🟢, app-side watcher)
5. **remote_trigger** (🔵, the cloud runtime — do when you build the backend; use API
   models so the server needs no GPUs)
6. **send_message** + **push_notification (phone)** (🔵, on top of the cloud runtime +
   mobile companion)

**Takeaway:** four of the six are **local-buildable today** — you don't need the cloud
for workflow, desktop notifications, scheduled wakeups, or monitors. Only `remote_trigger`
and `send_message` (and phone push) truly need the cloud backend. So "completing the 31"
is mostly a matter of prioritizing local builds; only the last couple wait on cloud.
