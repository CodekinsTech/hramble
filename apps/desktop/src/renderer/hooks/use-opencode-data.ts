import type {
	Agent as SdkAgent,
	Command as SdkCommand,
	Config as SdkConfig,
	Model as SdkModel,
	Provider as SdkProvider,
	ProviderAuthMethod as SdkProviderAuthMethod,
} from "../lib/opencode-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useCallback } from "react"
import { serverConnectedAtom } from "../atoms/connection"
import { engineConnectedAtom } from "../atoms/engine"
import { isMockModeAtom } from "../atoms/mock-mode"
import { MOCK_AGENTS, MOCK_CONFIG, MOCK_PROVIDERS } from "../lib/mock-data"
import { fetchModelState, updateModelRecent } from "../services/backend"
import {
	listEngineProviders,
	getEngineConfig,
	type EngineProvidersResponse,
} from "../services/engine-client"

// ============================================================
// Engine → UI adapters (map the engine's catalog to SDK-shaped data)
// ============================================================

/** Adapt the engine's /providers response to the SdkProvider-shaped UI model. */
function adaptEngineProviders(res: EngineProvidersResponse): ProvidersData {
	const defaults: Record<string, string> = {}
	const providers = res.providers.map((p) => {
		if (p.models[0]) defaults[p.id] = p.models[0].id
		const models: Record<string, unknown> = {}
		for (const m of p.models) {
			models[m.id] = {
				id: m.id,
				name: m.name,
				release_date: "",
				attachment: false,
				reasoning: false,
				temperature: true,
				tool_call: m.supportsTools,
				cost: { input: 0, output: 0 },
				limit: { context: m.contextWindow, output: 0 },
				capabilities: {
					input: { image: m.supportsVision, pdf: false, audio: false, video: false },
					attachment: false,
				},
			}
		}
		return { id: p.id, name: p.name, env: [], models } as unknown as SdkProvider
	})
	// Ensure the engine's zero-setup default is present.
	if (res.default?.provider && res.default?.model) {
		defaults[res.default.provider] = res.default.model
	}
	return { providers, defaults }
}

// ============================================================
// Re-exports — SDK-shaped types (vendored copy, no @opencode-ai/sdk dependency)
// ============================================================

export type { SdkAgent, SdkCommand, SdkConfig, SdkModel, SdkProvider, SdkProviderAuthMethod }

// ============================================================
// Derived types for our UI layer
// ============================================================

export interface ProvidersData {
	providers: SdkProvider[]
	defaults: Record<string, string>
}

export interface VcsData {
	branch: string
}

export interface CompactionConfig {
	/** Whether automatic compaction is enabled (default: true) */
	auto?: boolean
	/** Token buffer reserved for compaction (default: 20,000) */
	reserved?: number
}

export interface ConfigData {
	model?: string
	smallModel?: string
	defaultAgent?: string
	compaction?: CompactionConfig
}

export interface ModelRef {
	providerID: string
	modelID: string
}

// ============================================================
// Helpers
// ============================================================

export function parseModelRef(ref: string): ModelRef | null {
	const slashIndex = ref.indexOf("/")
	if (slashIndex === -1) return null
	return {
		providerID: ref.slice(0, slashIndex),
		modelID: ref.slice(slashIndex + 1),
	}
}

export function getModelDisplayName(modelID: string, providers: SdkProvider[]): string {
	for (const provider of providers) {
		const model = provider.models[modelID]
		if (model) return model.name
	}
	return modelID
		.replace(/-\d{8}$/, "")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getModelVariants(
	providerID: string,
	modelID: string,
	providers: SdkProvider[],
): string[] {
	for (const provider of providers) {
		if (provider.id !== providerID) continue
		const model = provider.models[modelID]
		if (model?.variants) {
			return Object.keys(model.variants)
		}
	}
	return []
}

export function resolveEffectiveModel(
	selectedModel: ModelRef | null,
	agent: SdkAgent | null,
	configModel: string | undefined,
	providerDefaults: Record<string, string>,
	providers: SdkProvider[],
	recentModels?: ModelRef[],
): ModelRef | null {
	if (selectedModel) return selectedModel
	if (agent?.model) {
		return { providerID: agent.model.providerID, modelID: agent.model.modelID }
	}
	if (configModel) {
		const ref = parseModelRef(configModel)
		if (ref) return ref
	}
	if (recentModels) {
		for (const recent of recentModels) {
			const provider = providers.find((p) => p.id === recent.providerID)
			if (provider?.models[recent.modelID]) {
				return recent
			}
		}
	}
	for (const provider of providers) {
		const defaultModelId = providerDefaults[provider.id]
		if (defaultModelId) {
			return { providerID: provider.id, modelID: defaultModelId }
		}
	}
	return null
}

export function getModelInputCapabilities(
	model: ModelRef | null,
	providers: SdkProvider[],
): { image: boolean; pdf: boolean; attachment: boolean } | null {
	if (!model) return null
	for (const provider of providers) {
		if (provider.id !== model.providerID) continue
		const m = provider.models[model.modelID]
		if (m?.capabilities) {
			return {
				image: m.capabilities.input.image,
				pdf: m.capabilities.input.pdf,
				attachment: m.capabilities.attachment,
			}
		}
	}
	return null
}

// ============================================================
// Query Key Factories
// ============================================================

export const queryKeys = {
	providers: (directory: string) => ["providers", directory] as const,
	config: (directory: string) => ["config", directory] as const,
	vcs: (directory: string) => ["vcs", directory] as const,
	agents: (directory: string) => ["agents", directory] as const,
	commands: (directory: string) => ["commands", directory] as const,
	modelState: ["modelState"] as const,
	allProviders: ["allProviders"] as const,
	connectedProviders: ["connectedProviders"] as const,
	providerAuthMethods: ["providerAuthMethods"] as const,
}

// ============================================================
// Hooks (TanStack Query) — all backed by the xot engine
// ============================================================

export function useProviders(directory: string | null): {
	data: ProvidersData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.providers(directory ?? ""),
		queryFn: async (): Promise<ProvidersData> => adaptEngineProviders(await listEngineProviders()),
		enabled: !!directory && (connected || engineConnected) && !isMockMode,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.providers(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			data: MOCK_PROVIDERS as unknown as ProvidersData,
			loading: false,
			error: null,
			reload,
		}
	}

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load providers") : null,
		reload,
	}
}

export function useConfig(directory: string | null): {
	data: ConfigData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.config(directory ?? ""),
		queryFn: async (): Promise<ConfigData> => {
			const cfg = await getEngineConfig()
			return { model: `${cfg.default.provider}/${cfg.default.model}`, defaultAgent: "build" }
		},
		enabled: !!directory && (connected || engineConnected) && !isMockMode,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.config(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			data: MOCK_CONFIG,
			loading: false,
			error: null,
			reload,
		}
	}

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load config") : null,
		reload,
	}
}

export function useVcs(directory: string | null): {
	data: VcsData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.vcs(directory ?? ""),
		// The engine has no VCS endpoint yet — branch info is unavailable, same as
		// the previous engine-mode behavior (the OpenCode client returned null here).
		queryFn: async (): Promise<VcsData> => ({ branch: "" }),
		enabled: !!directory && (connected || engineConnected) && !isMockMode,
		staleTime: 30_000,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.vcs(directory) })
		}
	}, [directory, queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load VCS info") : null,
		reload,
	}
}

export function useOpenCodeAgents(directory: string | null): {
	agents: SdkAgent[]
	loading: boolean
	error: string | null
	reload: () => void
} {
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.agents(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			agents: MOCK_AGENTS as unknown as SdkAgent[],
			loading: false,
			error: null,
			reload,
		}
	}

	// The engine selects its agent (build/plan) via the prompt's `agent` param;
	// there is no agent-catalog endpoint, so the picker uses its "build" default.
	return { agents: [], loading: false, error: null, reload }
}

export function useModelState(): {
	recentModels: ModelRef[]
	loading: boolean
	error: string | null
	addRecent: (model: ModelRef) => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.modelState,
		queryFn: async (): Promise<ModelRef[]> => {
			const result = await fetchModelState()
			return result.recent ?? []
		},
		enabled: (connected || engineConnected) && !isMockMode,
		staleTime: 60_000,
	})

	const addRecent = useCallback(
		(model: ModelRef) => {
			queryClient.setQueryData<ModelRef[]>(queryKeys.modelState, (prev) => {
				const key = (m: ModelRef) => `${m.providerID}/${m.modelID}`
				const seen = new Set<string>()
				const updated: ModelRef[] = []
				for (const entry of [model, ...(prev ?? [])]) {
					const k = key(entry)
					if (!seen.has(k) && updated.length < 10) {
						seen.add(k)
						updated.push(entry)
					}
				}
				return updated
			})

			updateModelRecent(model).catch((err) => {
				console.error("Failed to persist model to recent:", err)
			})
		},
		[queryClient],
	)

	// Return mock data if in mock mode
	if (isMockMode) {
		return {
			recentModels: [{ providerID: "bedrock", modelID: "anthropic.claude-opus-4-6" }],
			loading: false,
			error: null,
			addRecent: () => {
				// No-op in mock mode
			},
		}
	}

	return {
		recentModels: data ?? [],
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load model state") : null,
		addRecent,
	}
}

export function useServerCommands(_directory: string | null): SdkCommand[] {
	// The engine has no custom slash-command catalog.
	return []
}

// ============================================================
// Provider catalog types
// ============================================================

/** A provider from the full catalog (GET /provider/) */
export interface CatalogProvider {
	id: string
	name: string
	api?: string
	npm?: string
	env: string[]
	models: Record<string, unknown>
}

/** Full provider list response */
export interface AllProvidersData {
	all: CatalogProvider[]
	defaults: Record<string, string>
	connected: string[]
}

/** A connected provider with source info (from GET /config/providers) */
export interface ConnectedProviderInfo {
	id: string
	name: string
	source: "env" | "config" | "custom" | "api"
	env: string[]
}

// ============================================================
// Provider management hooks
// ============================================================

/** Fetches the full provider catalog (connected and unconnected) from the engine. */
export function useAllProviders(): {
	data: AllProvidersData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.allProviders,
		queryFn: async (): Promise<AllProvidersData> => {
			const res = await listEngineProviders()
			const all: CatalogProvider[] = res.providers.map((p) => ({
				id: p.id,
				name: p.name,
				env: [],
				models: Object.fromEntries(p.models.map((m) => [m.id, { id: m.id, name: m.name }])),
			}))
			const defaults: Record<string, string> = {}
			for (const p of res.providers) if (p.models[0]) defaults[p.id] = p.models[0].id
			return { all, defaults, connected: res.providers.filter((p) => p.connected).map((p) => p.id) }
		},
		enabled: (connected || engineConnected) && !isMockMode,
	})

	const reload = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.allProviders })
	}, [queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load providers") : null,
		reload,
	}
}

/** Fetches connected providers with their `source` field from the engine. */
export function useConnectedProviders(): {
	data: Map<string, ConnectedProviderInfo> | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const engineConnected = useAtomValue(engineConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.connectedProviders,
		queryFn: async (): Promise<Map<string, ConnectedProviderInfo>> => {
			const map = new Map<string, ConnectedProviderInfo>()
			const res = await listEngineProviders()
			for (const p of res.providers) {
				if (p.connected) {
					map.set(p.id, { id: p.id, name: p.name, source: p.keyless ? "config" : "api", env: [] })
				}
			}
			return map
		},
		enabled: (connected || engineConnected) && !isMockMode,
	})

	const reload = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.connectedProviders })
	}, [queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load providers") : null,
		reload,
	}
}

/**
 * Auth methods per provider. The engine connects providers by API key (see the
 * provider settings), with no OpenCode-style auth-method catalog — returns empty.
 */
export function useProviderAuthMethods(): {
	data: Record<string, SdkProviderAuthMethod[]> | null
	loading: boolean
	error: string | null
} {
	return { data: {}, loading: false, error: null }
}
