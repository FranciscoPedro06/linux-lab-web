import { useQuery } from '@tanstack/react-query'
import type { ApiError } from '../auth/api.ts'
import { type CatalogModule, fetchMission, fetchModules, type MissionDetail } from './api.ts'

export const catalogKeys = {
  modules: ['catalog', 'modules'] as const,
  mission: (slug: string) => ['catalog', 'mission', slug] as const,
}

// Retrying does not change these answers: an expired session (the page checks it
// again) or a mission that is missing or unpublished.
function settled(error: ApiError): boolean {
  return error.status === 401 || error.status === 404
}

export function useModules() {
  return useQuery<CatalogModule[], ApiError>({
    queryKey: catalogKeys.modules,
    queryFn: () => fetchModules(),
    retry: (count, error) => !settled(error) && count < 1,
  })
}

export function useMission(slug: string) {
  return useQuery<MissionDetail, ApiError>({
    queryKey: catalogKeys.mission(slug),
    queryFn: () => fetchMission(slug),
    retry: (count, error) => !settled(error) && count < 1,
  })
}
