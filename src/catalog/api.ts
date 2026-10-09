// Client for the catalog endpoints (see docs/api.md in linux-lab-api). The catalog
// holds published content only; hidden mission data never reaches the client.
import { apiRequest, ApiError } from '../auth/api.ts'

export type MissionCard = {
  slug: string
  title: string
  summary: string
  difficulty: number
  estimated_minutes: number
  tags: string[]
  version: number
  requires_answer: boolean
}

export type CatalogModule = {
  slug: string
  title: string
  description: string
  missions: MissionCard[]
}

export type MissionDetail = MissionCard & {
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
