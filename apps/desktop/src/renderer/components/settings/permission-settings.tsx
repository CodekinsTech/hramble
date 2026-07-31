import { Badge } from "@hramble/ui/components/badge"
import { Button } from "@hramble/ui/components/button"
import { Input } from "@hramble/ui/components/input"
import { useAtom } from "jotai"
import { Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import {
	newRuleId,
	type PermissionAction,
	PERMISSION_TYPES,
	permissionRulesAtom,
	type UserPermissionRule,
} from "../../atoms/permission-rules"
import { SettingsSection } from "./settings-section"

const ACTIONS: PermissionAction[] = ["allow", "ask", "deny"]

const actionBadge: Record<PermissionAction, string> = {
	allow: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	ask: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	deny: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
}

/** Short, human label for a project directory (its last path segment). */
function projectLabel(dir?: string): string {
	if (!dir) return "Unknown project"
	const parts = dir.split("/").filter(Boolean)
	return parts[parts.length - 1] ?? dir
}

const selectCls =
	"h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function PermissionSettings() {
	const [rules, setRules] = useAtom(permissionRulesAtom)

	const [permission, setPermission] = useState<string>("bash")
	const [pattern, setPattern] = useState<string>("")
	const [action, setAction] = useState<PermissionAction>("allow")

	const userRules = useMemo(() => rules.filter((r) => r.scope === "user"), [rules])
	const projectGroups = useMemo(() => {
		const byDir = new Map<string, UserPermissionRule[]>()
		for (const r of rules) {
			if (r.scope !== "project") continue
			const key = r.directory ?? ""
			byDir.set(key, [...(byDir.get(key) ?? []), r])
		}
		return [...byDir.entries()]
	}, [rules])

	function addRule() {
		const pat = pattern.trim() || "*"
		const dup = userRules.some(
			(r) => r.permission === permission && r.pattern === pat && r.action === action,
		)
		if (dup) return
		const rule: UserPermissionRule = {
			id: newRuleId(permission),
			permission,
			pattern: pat,
			action,
			scope: "user",
			createdAt: Date.now(),
		}
		setRules([...rules, rule])
		setPattern("")
	}

	function deleteRule(id: string) {
		setRules(rules.filter((r) => r.id !== id))
	}

	function setRuleAction(id: string, next: PermissionAction) {
		setRules(rules.map((r) => (r.id === id ? { ...r, action: next } : r)))
	}

	function RuleRow({ rule }: { rule: UserPermissionRule }) {
		return (
			<div className="flex items-center gap-3 px-4 py-2.5">
				<Badge className={`shrink-0 capitalize ${actionBadge[rule.action]}`} variant="secondary">
					{rule.action}
				</Badge>
				<span className="shrink-0 font-mono text-xs text-muted-foreground">{rule.permission}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs">{rule.pattern}</span>
				{rule.note && (
					<span className="hidden max-w-[30%] shrink truncate text-xs text-muted-foreground/70 sm:inline">
						{rule.note}
					</span>
				)}
				<select
					className={selectCls}
					value={rule.action}
					onChange={(e) => setRuleAction(rule.id, e.target.value as PermissionAction)}
					aria-label="Change action"
				>
					{ACTIONS.map((a) => (
						<option key={a} value={a}>
							{a}
						</option>
					))}
				</select>
				<Button
					size="icon"
					variant="ghost"
					className="size-8 shrink-0 text-muted-foreground hover:text-rose-500"
					onClick={() => deleteRule(rule.id)}
					aria-label="Delete rule"
				>
					<Trash2Icon className="size-4" />
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">Permissions</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Durable rules that decide when Hramble asks before acting. They persist across
					sessions and layer on top of the current mode. Precedence, lowest to highest:{" "}
					<span className="font-medium">mode → your rules → project rules</span>. Picking
					“Always” on a prompt saves a project rule here automatically.
				</p>
			</div>

			{/* Add a rule (user scope — applies to every project) */}
			<SettingsSection title="Add a rule" description="Applies to every project.">
				<div className="flex flex-wrap items-center gap-2 px-4 py-3">
					<select
						className={selectCls}
						value={permission}
						onChange={(e) => setPermission(e.target.value)}
						aria-label="Permission type"
					>
						{PERMISSION_TYPES.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
					<Input
						className="h-9 min-w-[180px] flex-1 font-mono text-xs"
						placeholder="pattern, e.g. *npm test* or *"
						value={pattern}
						onChange={(e) => setPattern(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") addRule()
						}}
					/>
					<select
						className={selectCls}
						value={action}
						onChange={(e) => setAction(e.target.value as PermissionAction)}
						aria-label="Action"
					>
						{ACTIONS.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
					<Button onClick={addRule}>Add</Button>
				</div>
			</SettingsSection>

			{/* User-scope rules */}
			<SettingsSection title="Your rules" description="Apply across all projects.">
				{userRules.length === 0 ? (
					<p className="px-4 py-3 text-sm text-muted-foreground">No rules yet.</p>
				) : (
					<div className="divide-y divide-border/40">
						{userRules.map((r) => (
							<RuleRow key={r.id} rule={r} />
						))}
					</div>
				)}
			</SettingsSection>

			{/* Project-scope rules (from "Always") */}
			<SettingsSection
				title="Project rules"
				description="Scoped to a single project. Override your rules there."
			>
				{projectGroups.length === 0 ? (
					<p className="px-4 py-3 text-sm text-muted-foreground">
						No project rules yet. Choosing “Always” on a permission prompt adds one here.
					</p>
				) : (
					<div className="space-y-4">
						{projectGroups.map(([dir, group]) => (
							<div key={dir}>
								<div className="px-4 pb-1 text-xs font-medium text-muted-foreground">
									{projectLabel(dir)}
								</div>
								<div className="divide-y divide-border/40">
									{group.map((r) => (
										<RuleRow key={r.id} rule={r} />
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</SettingsSection>
		</div>
	)
}
