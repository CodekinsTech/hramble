/**
 * Fallback model — the model to retry a failed turn with.
 *
 * When a turn errors (provider overloaded, model unavailable, rate limit), the
 * error banner offers a one-click retry, and "retry with another model" lets the
 * user switch. The last model they retried with is remembered here so it's the
 * default next time — a lightweight, safe version of Claude Code's automatic
 * fallback-model switching (manual click, so a paid model never auto-fires in a
 * loop).
 */
import { atomWithStorage } from "jotai/utils"
import type { ModelRef } from "../hooks/use-opencode-data"

export const fallbackModelAtom = atomWithStorage<ModelRef | null>("hramble:fallbackModel", null)
