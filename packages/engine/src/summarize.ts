import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js"
import type { ModelRef } from "./types.js"
import { getProvider, getModel } from "./providers.js"
import { resolveMaxOutputTokens } from "./limits.js"

const SUMMARY_INSTRUCTION =
	"You are compacting a coding-assistant conversation. Write a concise but complete " +
	"summary that preserves: the user's goals, key decisions, files and code changed, " +
	"important tool results, and any open tasks — so the conversation can continue " +
	"seamlessly with this summary as the only prior context. Use plain prose and short " +
	"bullet points. Do not add commentary or a preamble."

/** Flatten a structured transcript to readable text for the summarizer. */
function flatten(messages: MessageParam[]): string {
	const lines: string[] = []
	for (const m of messages) {
		const role = m.role === "user" ? "User" : "Assistant"
		if (typeof m.content === "string") {
			lines.push(`${role}: ${m.content}`)
			continue
		}
		for (const block of m.content) {
			if (typeof block !== "object" || block === null || !("type" in block)) continue
			if (block.type === "text") lines.push(`${role}: ${(block as { text: string }).text}`)
			else if (block.type === "tool_use")
				lines.push(`${role} [calls ${(block as { name: string }).name}]: ${JSON.stringify((block as { input: unknown }).input)}`)
			else if (block.type === "tool_result")
				lines.push(`Tool result: ${(block as { content: string }).content}`)
		}
	}
	return lines.join("\n")
}

/** Produce a single-shot summary of a conversation for compaction. */
export async function summarizeConversation(model: ModelRef, messages: MessageParam[]): Promise<string> {
	const provider = getProvider(model.provider)
	const useAnthropic = !provider || provider.type === "anthropic"
	const maxTokens = resolveMaxOutputTokens(getModel(model.provider, model.model)?.contextWindow ?? 128_000)
	// Cap the transcript so a very long session can't overflow the summarizer's
	// context. Budget ~3 chars/token against 60% of the window, keeping the tail
	// (most recent, highest-signal) plus a truncation marker.
	const window = getModel(model.provider, model.model)?.contextWindow ?? 128_000
	const maxChars = Math.floor(window * 0.6) * 3
	let transcript = flatten(messages)
	if (transcript.length > maxChars) {
		transcript = `[... earlier conversation truncated ...]\n${transcript.slice(transcript.length - maxChars)}`
	}
	const userPrompt = `${SUMMARY_INSTRUCTION}\n\n--- CONVERSATION ---\n${transcript}\n--- END ---`

	if (useAnthropic) {
		const client = new Anthropic({ apiKey: model.apiKey })
		const res = await client.messages.create({
			model: model.model,
			max_tokens: maxTokens,
			messages: [{ role: "user", content: userPrompt }],
		})
		return res.content
			.map((b) => (b.type === "text" ? b.text : ""))
			.join("")
			.trim()
	}

	const hasKey = Boolean(model.apiKey?.trim())
	const client = new OpenAI({
		apiKey: hasKey ? model.apiKey : "unused",
		baseURL: model.baseURL ?? provider?.baseURL,
		...(hasKey ? {} : { defaultHeaders: { Authorization: null } }),
	})
	const res = await client.chat.completions.create({
		model: model.model,
		max_tokens: maxTokens,
		messages: [{ role: "user", content: userPrompt }],
	})
	return (res.choices[0]?.message?.content ?? "").trim()
}
