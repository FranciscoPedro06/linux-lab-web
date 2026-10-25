import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../auth/api.ts'
import { useUserMutation } from '../auth/session.ts'
import type { CatalogModule, MissionDetail, Progress } from '../catalog/api.ts'
import { catalogKeys } from '../catalog/queries.ts'
import {
  createLab,
  endLab,
  fetchCurrentLab,
  fetchHistory,
  fetchLab,
  fetchLabs,
  type HistoryEntry,
  isTransient,
  type Lab,
  replaceLab,
  validateLab,
  type ValidationRun,
} from './api.ts'

// Poll quickly while the API is moving a lab between states, and slowly while it is
// ready, since the reaper can end it at any time.
const TRANSIENT_POLL_MS = 1000
const READY_POLL_MS = 15000

export const labKeys = {
  all: ['labs'] as const,
  current: ['labs', 'current'] as const,
  list: ['labs', 'list'] as const,
  one: (id: string) => ['labs', 'one', id] as const,
  // Under ['labs'], so it is dropped with the rest when the session changes.
  history: (id: string) => ['labs', 'history', id] as const,
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

export const HISTORY_POLL_MS = 5000

// The lab's command history, read incrementally: each fetch asks only for the entries
// after the last one held and appends them, so polling never duplicates an entry and a
// failed poll is made up by the next one. While `live` (the lab is ready) it is read
// again every HISTORY_POLL_MS, only while the tab is visible. Otherwise it is read once
// when `enabled`, and again only when the page asks (refetch).
//
// An answer for a previous user is never stored, for two reasons that each suffice: the
// key is under ['labs'], which a session change drops (forgetUserData), and the request
// uses the query's signal, so it is aborted once no page shows the history, as happens
// whenever the session changes.
export function useLabHistory(
  labId: string,
  { live, enabled }: { live: boolean; enabled: boolean },
) {
  const client = useQueryClient()
  return useQuery<HistoryEntry[], ApiError>({
    queryKey: labKeys.history(labId),
    queryFn: async ({ signal }) => {
      const held = client.getQueryData<HistoryEntry[]>(labKeys.history(labId)) ?? []
      const fresh = await fetchHistory(labId, held.at(-1)?.seq ?? 0, signal)
      return fresh.length === 0 ? held : [...held, ...fresh]
    },
    enabled,
    refetchInterval: live ? HISTORY_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: live ? 0 : Infinity,
    // A lab that does not exist (or is not the user's) stays that way.
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

// Lab and validation mutations write to the cache through useUserMutation, so an
// answer that arrives after another user signed in on this tab changes nothing.

// The variable is the mission's slug. A refusal (another mission's lab, one being
// started or ended) also refreshes the current lab, so the page shows what blocks it.
export function useCreateLab() {
  const client = useQueryClient()
  const store = useStoreLab()
  return useUserMutation<Lab, string>({
    mutationFn: (missionSlug) => createLab(missionSlug),
    onSuccess: store,
    onError: () => void client.invalidateQueries({ queryKey: labKeys.current }),
  })
}

export function useEndLab() {
  const store = useStoreLab()
  return useUserMutation<Lab, string>({ mutationFn: (id) => endLab(id), onSuccess: store })
}

// A reset (the lab's own mission) or a mission switch (another one).
export type Replacement = {
  lab: Lab
  missionSlug: string
}

// Replacing a lab ends it and creates a new one, so it is never retried by the client:
// the page reads the state again and lets the user decide. Whatever the outcome, the
// old lab, the current lab, the list and the details of both missions are read again:
// the old lab may have ended even when the request failed, and a mission's detail is
// shown at the version of the user's active lab for it.
export function useReplaceLab() {
  const client = useQueryClient()
  return useUserMutation<Lab, Replacement>({
    mutationFn: ({ lab, missionSlug }) => replaceLab(lab.id, missionSlug),
    retry: false,
    onSuccess: (created, replacement) => {
      client.setQueryData(labKeys.one(created.id), created)
      client.setQueryData(labKeys.current, created)
      refreshAfterReplacement(client, replacement)
    },
    onError: (_error, replacement) => refreshAfterReplacement(client, replacement),
  })
}

function refreshAfterReplacement(client: QueryClient, { lab, missionSlug }: Replacement) {
  void client.invalidateQueries({ queryKey: labKeys.one(lab.id) })
  void client.invalidateQueries({ queryKey: labKeys.current })
  void client.invalidateQueries({ queryKey: labKeys.list })
  for (const slug of new Set([lab.mission?.slug, missionSlug])) {
    if (slug) void client.invalidateQueries({ queryKey: catalogKeys.mission(slug) })
  }
}

// Whether a failed validation request may still have been stored: the connection was
// lost, or something between the client and the API failed, possibly after the commit.
// A refusal from the API itself (4xx) stored nothing.
function outcomeUnknown(error: ApiError): boolean {
  return error.status === 0 || error.status >= 500
}

// Validation runs only when the student asks: no retry, no polling. A refusal because
// the lab is no longer usable refreshes the lab, so the page shows its state.
//
// The response carries the user's progress on the mission, which is copied into the
// cached catalog and mission detail. When the request failed in a way that leaves the
// outcome unknown, those are fetched again instead, since a completion may have been
// recorded before the response was lost.
export function useValidateLab(labId: string, missionSlug: string) {
  const client = useQueryClient()
  return useUserMutation<ValidationRun, string | undefined>({
    mutationFn: (answer) => validateLab(labId, answer),
    retry: false,
    onSuccess: (run) => storeProgress(client, run.mission.slug, run.progress),
    onError: (error) => {
      if (error.status === 404 || error.code === 'lab_not_ready') {
        void client.invalidateQueries({ queryKey: labKeys.one(labId) })
      }
      if (outcomeUnknown(error)) {
        void client.invalidateQueries({ queryKey: catalogKeys.modules })
        void client.invalidateQueries({ queryKey: catalogKeys.mission(missionSlug) })
      }
    },
  })
}

// Progress belongs to the mission, not to a version, so it applies to the detail
// whichever version it shows. Queries without data are left alone.
function storeProgress(client: QueryClient, slug: string, progress: Progress) {
  client.setQueryData<MissionDetail>(catalogKeys.mission(slug), (detail) =>
    detail ? { ...detail, progress } : detail,
  )
  client.setQueryData<CatalogModule[]>(catalogKeys.modules, (modules) =>
    modules?.map((module) => ({
      ...module,
      missions: module.missions.map((card) => (card.slug === slug ? { ...card, progress } : card)),
    })),
  )
}
