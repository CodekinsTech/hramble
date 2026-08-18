/**
 * Hook for searching files in the project via the OpenCode server.
 * Provides debounced file search with caching.
 * When query is empty, fetches an initial set of files.
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { getProjectClient } from "../services/connection-manager"
import { appStore } from "../atoms/store"
import { engineConnectedAtom } from "../atoms/engine"
import { findEngineFiles } from "../services/engine-client"

const FILE_SEARCH_DEBOUNCE_MS = 150

export function useFileSearch(directory: string | null, query: string, enabled = true) {
	const [debouncedQuery, setDebouncedQuery] = useState(query)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (timerRef.current) clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => {
			setDebouncedQuery(query)
		}, FILE_SEARCH_DEBOUNCE_MS)
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current)
		}
	}, [query])

	const { data, isLoading } = useQuery({
		queryKey: ["file-search", directory, debouncedQuery],
		queryFn: async () => {
			// Engine path: search files via the engine's /find endpoint.
			if (appStore.get(engineConnectedAtom)) {
				return await findEngineFiles(directory!, debouncedQuery)
			}
			const client = getProjectClient(directory!)
			if (!client) return []
			// Empty query returns initial/recent files from the server
			const result = await client.find.files({ query: debouncedQuery })
			return (result.data ?? []) as string[]
		},
		enabled: !!directory && enabled,
		staleTime: 10_000,
	})

	return {
		files: data ?? [],
		isLoading,
	}
}
