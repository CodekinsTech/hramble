import type { Todo } from "../types.js"

export interface TodoWriteInput {
	todos: Todo[]
}

/** Validate + normalize the model's todo payload. */
export function normalizeTodos(input: TodoWriteInput): Todo[] {
	if (!Array.isArray(input.todos)) return []
	return input.todos
		.filter((t) => t && typeof t.content === "string" && t.content.trim())
		.map((t) => ({
			content: t.content.trim(),
			status:
				t.status === "in_progress" || t.status === "completed" ? t.status : "pending",
			activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
		}))
}

export const todoToolDefinition = {
	name: "todowrite",
	description:
		"Create and manage a structured task list for the current work. Use it for any task with 3+ distinct steps: write the todos up front, mark exactly one as in_progress while you work on it, and mark it completed the moment it's done. Skip it for trivial single-step tasks.",
	input_schema: {
		type: "object" as const,
		properties: {
			todos: {
				type: "array",
				description: "The full todo list (always send the complete list, not a delta).",
				items: {
					type: "object",
					properties: {
						content: { type: "string", description: "The task, in imperative form." },
						status: {
							type: "string",
							enum: ["pending", "in_progress", "completed"],
							description: "Task status. Exactly one task should be in_progress at a time.",
						},
						activeForm: {
							type: "string",
							description: 'Present-continuous form shown while active, e.g. "Running tests".',
						},
					},
					required: ["content", "status"],
				},
			},
		},
		required: ["todos"],
	},
}
