// Client for the lab endpoints (see docs/api.md in linux-lab-api). The API owns the
// lifecycle; this code only reads it and asks for changes.
import { apiRequest, ApiError } from '../auth/api.ts'

export type LabStatus = 'provisioning' | 'ready' | 'terminating' | 'terminated' | 'failed'

export type EndReason =
  | 'user'
  | 'logout'
  | 'no_terminal'
  | 'no_input'
  | 'max_lifetime'
  | 'oom'
  | 'container_lost'
  | 'provisioning_failed'
  | 'provisioning_timeout'

// The mission version a lab was created for. It does not change while the lab exists.
export type LabMission = {
  slug: string
  title: string
  version: number
}

export type Lab = {
  id: string
  status: LabStatus
  end_reason: EndReason | null
  created_at: string
  expires_at: string
  ended_at: string | null
  // null only for labs created before labs were tied to missions.
  mission: LabMission | null
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const unexpected = () =>
  new ApiError(0, 'unexpected_response', 'Resposta inesperada do servidor. Tente novamente.')

async function expectLab(request: Promise<Lab | undefined>): Promise<Lab> {
  const lab = await request
  if (!lab) throw unexpected()
  return lab
}

// The user's lab in provisioning, ready or terminating, or null.
export async function fetchCurrentLab(fetchImpl?: FetchLike): Promise<Lab | null> {
  return (await apiRequest<Lab | null>('/api/labs/current', {}, fetchImpl)) ?? null
}

// The user's most recent labs, newest first.
export async function fetchLabs(fetchImpl?: FetchLike): Promise<Lab[]> {
  return (await apiRequest<Lab[]>('/api/labs', {}, fetchImpl)) ?? []
}

export function fetchLab(id: string, fetchImpl?: FetchLike): Promise<Lab> {
  return expectLab(apiRequest<Lab>(`/api/labs/${encodeURIComponent(id)}`, {}, fetchImpl))
}

// Starts a lab for the mission, or returns the user's ready lab for that mission. The
// API answers only once the mission's setup has run, which can take about a minute.
export function createLab(missionSlug: string, fetchImpl?: FetchLike): Promise<Lab> {
  return expectLab(
    apiRequest<Lab>('/api/labs', { method: 'POST', body: { mission_slug: missionSlug } }, fetchImpl),
  )
}

export function endLab(id: string, fetchImpl?: FetchLike): Promise<Lab> {
  return expectLab(
    apiRequest<Lab>(`/api/labs/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl),
  )
}

// States the API moves out of on its own; the client polls while it sees them.
export function isTransient(status: LabStatus): boolean {
  return status === 'provisioning' || status === 'terminating'
}

export function isEnded(status: LabStatus): boolean {
  return status === 'terminating' || status === 'terminated' || status === 'failed'
}

export const statusLabel: Record<LabStatus, string> = {
  provisioning: 'Preparando',
  ready: 'Pronto',
  terminating: 'Encerrando',
  terminated: 'Encerrado',
  failed: 'Falhou',
}

export const endReasonMessage: Record<EndReason, string> = {
  user: 'Você encerrou o laboratório.',
  logout: 'O laboratório foi encerrado quando você saiu da conta.',
  no_terminal: 'O laboratório foi encerrado após 15 minutos sem terminal aberto.',
  no_input: 'O laboratório foi encerrado após 30 minutos sem nada digitado no terminal.',
  max_lifetime: 'O laboratório atingiu o tempo máximo de 2 horas.',
  oom: 'O laboratório foi encerrado porque excedeu o limite de memória (512 MB). Os arquivos e processos dele foram perdidos.',
  container_lost: 'O laboratório parou inesperadamente.',
  provisioning_failed: 'Não foi possível iniciar o laboratório.',
  provisioning_timeout: 'O laboratório demorou demais para iniciar.',
}
