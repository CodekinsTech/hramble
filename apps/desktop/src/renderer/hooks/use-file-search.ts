/**
 * Hook for searching files in the project via the xot engine.
 * Provides debounced file search with caching.
 * When query is empty, fetches an initial set of files.
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
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
			// Search files via the engine's /find endpoint.
			return await findEngineFiles(directory!, debouncedQuery)
		},
		enabled: !!directory && enabled,
		staleTime: 10_000,
	})

	return {
		files: data ?? [],
		isLoading,
	}
}
