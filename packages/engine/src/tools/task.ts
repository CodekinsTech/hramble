export interface TaskInput {
	description: string
	prompt: string
}

export const taskToolDefinition = {
	name: "task",
	description:
		"Delegate a focused, read-only research task to a sub-agent. The sub-agent can read files, search (grep/glob), and fetch URLs, then returns its findings as text. Use it to explore the codebase or gather context without cluttering the main thread. The sub-agent cannot modify files or run commands — do that yourself in the main thread after reviewing its findings.",
	input_schema: {
		type: "object" as const,
		properties: {
			description: { type: "string", description: "A short (3-5 word) label for the task." },
			prompt: {
				type: "string",
				description:
					"The full instruction for the sub-agent. Be specific about what to find and what to report back, since you won't see its intermediate steps — only its final answer.",
			},
		},
		required: ["description", "prompt"],
	},
}
