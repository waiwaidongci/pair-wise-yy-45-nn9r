import type {
  Annotation,
  ConflictBody,
  DecisionValue,
  RoundName,
  ServerSample,
  SnapshotSummary,
} from '../api/types'

export class NetworkOfflineError extends Error {
  constructor() {
    super('当前处于离线状态，请求未发出，已保留在本地待处理队列。')
    this.name = 'NetworkOfflineError'
  }
}

export class ConflictError extends Error {
  body: ConflictBody
  constructor(body: ConflictBody) {
    super(body.message)
    this.name = 'ConflictError'
    this.body = body
  }
}

/** API 基址；浏览器内为空（同源相对路径），Node 测试可通过全局变量注入 */
const apiBase = () => (globalThis as unknown as { __API_BASE__?: string }).__API_BASE__ ?? ''

async function request<T>(url: string, init: RequestInit & { clientId?: string } = {}): Promise<T> {
  const { clientId, headers, ...rest } = init
  const response = await fetch(`${apiBase()}${url}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(clientId ? { 'X-Client-Id': clientId } : {}), ...headers },
  })
  if (response.status === 409) {
    const body = (await response.json()) as ConflictBody
    if (body && body.error === 'conflict') throw new ConflictError(body)
    // 快照过期等其他 409 直接抛出携带 body 的普通错误
    throw Object.assign(new Error(body.message ?? '版本冲突'), { body })
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw Object.assign(new Error(body?.message ?? `请求失败（${response.status}）`), { body, status: response.status })
  }
  return (await response.json()) as T
}

export const api = {
  listSamples: () => request<ServerSample[]>('/api/samples'),
  getSample: (id: string) => request<ServerSample>(`/api/samples/${id}`),

  addAnnotation: (
    sampleId: string,
    clientId: string,
    payload: { x: number; y: number; part: string; content: string; round?: RoundName; baseVersion: number },
  ) => request<ServerSample>(`/api/samples/${sampleId}/annotations`, { method: 'POST', clientId, body: JSON.stringify(payload) }),

  resolveAnnotation: (
    sampleId: string,
    annotationId: string,
    clientId: string,
    payload: { status: Annotation['status']; baseVersion: number },
  ) => request<ServerSample>(`/api/samples/${sampleId}/annotations/${annotationId}/resolve`, {
    method: 'POST',
    clientId,
    body: JSON.stringify(payload),
  }),

  decide: (
    sampleId: string,
    clientId: string,
    payload: { proposalId: string; decision: DecisionValue; reason: string; baseVersion: number },
  ) => request<ServerSample>(`/api/samples/${sampleId}/decisions`, { method: 'POST', clientId, body: JSON.stringify(payload) }),

  lock: (sampleId: string, payload: { round: RoundName; note: string; baseVersion: number }) =>
    request<{ sample: ServerSample; snapshot: SnapshotSummary }>(`/api/samples/${sampleId}/lock`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  unlock: (sampleId: string) => request<ServerSample>(`/api/samples/${sampleId}/unlock`, { method: 'POST' }),

  listSnapshots: () => request<SnapshotSummary[]>('/api/snapshots'),
  exportSnapshot: (snapshotId: string) =>
    request<{ snapshotId: string; styleCode: string; checksum: string; checksumValid: boolean; sample: ServerSample }>(
      `/api/snapshots/${snapshotId}/export`,
    ),

  simulateRemote: (sampleId: string) =>
    request<ServerSample>(`/api/samples/${sampleId}/simulate-remote`, { method: 'POST' }),
}
