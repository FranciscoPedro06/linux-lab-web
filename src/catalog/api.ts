// Client for the catalog endpoints (see docs/api.md in linux-lab-api). The catalog
// holds published content only; hidden mission data never reaches the client.
import { apiRequest, ApiError } from '../auth/api.ts'

// The signed-in user's progress on a mission. A completion belongs to the mission:
// it stays when a newer version is published, and completed_version says which
// version it was recorded on.
export type Progress =
  | { status: 'completed'; completed_version: number; completed_at: string }
  | { status: 'not_completed'; completed_version: null; completed_at: null }

export type MissionCard = {
  slug: string
  title: string
  summary: string
  difficulty: number
  estimated_minutes: number
  tags: string[]
  // The mission's current version.
  version: number
  requires_answer: boolean
  progress: Progress
}

export type CatalogModule = {
  slug: string
  title: string
  description: string
  missions: MissionCard[]
}

// `version` is the version shown: the user's active lab's, if it has one for this
// mission. `current_version` is the catalog's.
export type MissionDetail = MissionCard & {
  current_version: number
  module: { slug: string; title: string }
  briefing: string // Markdown
  objectives: string[]
  hints: string[]
}

const unexpectedMessage = 'Resposta inesperada do servidor. Tente novamente.'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

// Published modules with their published missions, in catalog order.
export async function fetchModules(fetchImpl?: FetchLike): Promise<CatalogModule[]> {
  return (await apiRequest<CatalogModule[]>('/api/modules', {}, fetchImpl)) ?? []
}

export async function fetchMission(slug: string, fetchImpl?: FetchLike): Promise<MissionDetail> {
  const mission = await apiRequest<MissionDetail>(
    `/api/missions/${encodeURIComponent(slug)}`,
    {},
    fetchImpl,
  )
  if (!mission) throw new ApiError(0, 'unexpected_response', unexpectedMessage)
  return mission
}

export function difficultyLabel(difficulty: number): string {
  return `Dificuldade ${difficulty} de 5`
}

export function minutesLabel(minutes: number): string {
  return `cerca de ${minutes} min`
}

// The version a completion was recorded on, when it is not the catalog's current one.
// Informational only: the mission stays completed.
export function earlierCompletedVersion(progress: Progress, currentVersion: number): number | null {
  if (progress.status !== 'completed') return null
  return progress.completed_version === currentVersion ? null : progress.completed_version
}
