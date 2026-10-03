import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../auth/api.ts'
import { createLab, endLab, fetchCurrentLab, fetchLab, fetchLabs, isTransient, type Lab } from './api.ts'

// Poll quickly while the API is moving a lab between states, and slowly while it is
// ready, since the reaper can end it at any time.
const TRANSIENT_POLL_MS = 1000
const READY_POLL_MS = 15000

export const labKeys = {
  all: ['labs'] as const,
  current: ['labs', 'current'] as const,
  list: ['labs', 'list'] as const,
  one: (id: string) => ['labs', 'one', id] as const,
}

function pollInterval(lab: Lab | null | undefined): number | false {
  if (!lab) return false
  if (isTransient(lab.status)) return TRANSIENT_POLL_MS
  return lab.status === 'ready' ? READY_POLL_MS : false
}

export function useCurrentLab() {
  return useQuery({
    queryKey: labKeys.current,
    queryFn: () => fetchCurrentLab(),
    refetchInterval: (query) => pollInterval(query.state.data),
  })
}

export function useRecentLabs() {
  return useQuery({ queryKey: labKeys.list, queryFn: () => fetchLabs() })
}

export function useLab(id: string) {
  return useQuery<Lab, ApiError>({
    queryKey: labKeys.one(id),
    queryFn: () => fetchLab(id),
    refetchInterval: (query) => pollInterval(query.state.data),
    // A missing lab stays missing.
    retry: (count, error) => error.status !== 404 && count < 1,
  })
}

function useStoreLab() {
  const client = useQueryClient()
  return (lab: Lab) => {
    client.setQueryData(labKeys.one(lab.id), lab)
    void client.invalidateQueries({ queryKey: labKeys.current })
    void client.invalidateQueries({ queryKey: labKeys.list })
  }
}

export function useCreateLab() {
  const store = useStoreLab()
  return useMutation<Lab, ApiError>({ mutationFn: () => createLab(), onSuccess: store })
}

export function useEndLab() {
  const store = useStoreLab()
  return useMutation<Lab, ApiError, string>({ mutationFn: (id) => endLab(id), onSuccess: store })
}
