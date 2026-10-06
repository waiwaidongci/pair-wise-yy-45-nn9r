import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  Annotation,
  ConflictItem,
  DecisionValue,
  RoundName,
  ServerSample,
  SnapshotSummary,
} from '../api/types'

export type QueueKind = 'annotation' | 'decision' | 'resolve'

export type QueueEntry = {
  clientId: string
  sampleId: string
  kind: QueueKind
  createdAt: string
  /** 入队时本地缓存的服务器版本，重放时用于乐观锁 */
  baseVersion: number
  syncState: 'pending' | 'syncing' | 'conflict'
  lastError?: string
  conflicts?: ConflictItem[]
}

export type AnnotationEntry = QueueEntry & {
  kind: 'annotation'
  payload: { x: number; y: number; part: string; content: string; round?: RoundName }
  /** 离线期间本地生成的临时 id */
  localAnnotationId: string
}

export type DecisionEntry = QueueEntry & {
  kind: 'decision'
  payload: { proposalId: string; decision: DecisionValue; reason: string }
}

export type ResolveEntry = QueueEntry & {
  kind: 'resolve'
  payload: { annotationId: string; status: Annotation['status'] }
}

export type AnyQueueEntry = AnnotationEntry | DecisionEntry | ResolveEntry

export type LockState = {
  locking: boolean
  error?: string
  stale?: { message: string; serverVersion: number }
}

type SyncState = {
  online: boolean
  manualOffline: boolean
  lastSyncAt: string | null
  queue: AnyQueueEntry[]
  /** 服务器样衣缓存；断网刷新后作为只读底本 */
  samplesCache: ServerSample[]
  /** 服务器快照索引 */
  snapshots: SnapshotSummary[]
  /** 全局提示条消息（锁定拒绝等） */
  notice?: { severity: 'warning' | 'error' | 'success'; text: string }
}

const storageKey = 'garment-sampling-sync-v2'

type Persisted = Pick<SyncState, 'queue' | 'samplesCache' | 'snapshots' | 'lastSyncAt' | 'manualOffline'>

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (!Array.isArray(parsed.queue) || !Array.isArray(parsed.samplesCache)) return null
    // 异常退出时停留在 syncing 的条目回到 pending
    parsed.queue = parsed.queue.map((entry) =>
      entry.syncState === 'syncing' ? { ...entry, syncState: 'pending' as const } : entry,
    )
    return parsed
  } catch {
    return null
  }
}

const persisted = loadPersisted()

const initialState: SyncState = {
  online: navigator.onLine,
  manualOffline: persisted?.manualOffline ?? false,
  lastSyncAt: persisted?.lastSyncAt ?? null,
  queue: persisted?.queue ?? [],
  samplesCache: persisted?.samplesCache ?? [],
  snapshots: persisted?.snapshots ?? [],
}

const slice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setBrowserOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
    },
    setManualOffline(state, action: PayloadAction<boolean>) {
      state.manualOffline = action.payload
    },
    setLastSyncAt(state, action: PayloadAction<string | null>) {
      state.lastSyncAt = action.payload
    },
    setNotice(state, action: PayloadAction<SyncState['notice']>) {
      state.notice = action.payload
    },
    hydrateSamples(state, action: PayloadAction<ServerSample[]>) {
      const incoming = action.payload
      incoming.forEach((incomingSample) => {
        const index = state.samplesCache.findIndex((item) => item.id === incomingSample.id)
        if (index === -1) {
          state.samplesCache.push(incomingSample)
        } else {
          const current = state.samplesCache[index]
          // 服务器版本更新时才覆盖，绝不允许旧数据悄悄回退
          if (current.version == null || incomingSample.version >= current.version) {
            state.samplesCache[index] = incomingSample
          }
        }
      })
    },
    upsertSample(state, action: PayloadAction<ServerSample>) {
      const incoming = action.payload
      const index = state.samplesCache.findIndex((item) => item.id === incoming.id)
      if (index === -1) state.samplesCache.push(incoming)
      else if (incoming.version >= state.samplesCache[index].version) state.samplesCache[index] = incoming
    },
    setSnapshots(state, action: PayloadAction<SnapshotSummary[]>) {
      state.snapshots = action.payload
    },
    enqueue(state, action: PayloadAction<AnyQueueEntry>) {
      state.queue.push(action.payload)
    },
    removeEntry(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((entry) => entry.clientId !== action.payload)
    },
    markSyncing(state, action: PayloadAction<string>) {
      const entry = state.queue.find((item) => item.clientId === action.payload)
      if (entry) entry.syncState = 'syncing'
    },
    markConflict(state, action: PayloadAction<{ clientId: string; conflicts: ConflictItem[]; message: string }>) {
      const entry = state.queue.find((item) => item.clientId === action.payload.clientId)
      if (entry) {
        entry.syncState = 'conflict'
        entry.lastError = action.payload.message
        entry.conflicts = action.payload.conflicts
      }
    },
    markPending(state, action: PayloadAction<{ clientId: string; message?: string }>) {
      const entry = state.queue.find((item) => item.clientId === action.payload.clientId)
      if (entry) {
        entry.syncState = 'pending'
        if (action.payload.message) entry.lastError = action.payload.message
      }
    },
    /** 重新核对冲突后：用服务器最新版本作为 baseVersion，准备重放 */
    rebaseEntry(state, action: PayloadAction<{ clientId: string; baseVersion: number }>) {
      const entry = state.queue.find((item) => item.clientId === action.payload.clientId)
      if (entry) {
        entry.baseVersion = action.payload.baseVersion
        entry.syncState = 'pending'
        entry.lastError = undefined
        entry.conflicts = undefined
      }
    },
    /** 拒绝重放时升级 baseVersion 只是为了标识；真正丢弃由 removeEntry 完成 */
  },
})

export const {
  setBrowserOnline,
  setManualOffline,
  setLastSyncAt,
  setNotice,
  hydrateSamples,
  upsertSample,
  setSnapshots,
  enqueue,
  removeEntry,
  markSyncing,
  markConflict,
  markPending,
  rebaseEntry,
} = slice.actions

export const syncReducer = slice.reducer

/** 给页面使用的构造器：保证条目形状统一 */
export function makeAnnotationEntry(input: {
  sampleId: string
  baseVersion: number
  localAnnotationId: string
  payload: AnnotationEntry['payload']
  createdAt: string
}): AnnotationEntry {
  return {
    clientId: `ann-${input.sampleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sampleId: input.sampleId,
    kind: 'annotation',
    createdAt: input.createdAt,
    baseVersion: input.baseVersion,
    syncState: 'pending',
    localAnnotationId: input.localAnnotationId,
    payload: input.payload,
  }
}

export function makeDecisionEntry(input: {
  sampleId: string
  baseVersion: number
  payload: DecisionEntry['payload']
  createdAt: string
}): DecisionEntry {
  return {
    clientId: `dec-${input.sampleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sampleId: input.sampleId,
    kind: 'decision',
    createdAt: input.createdAt,
    baseVersion: input.baseVersion,
    syncState: 'pending',
    payload: input.payload,
  }
}

export function makeResolveEntry(input: {
  sampleId: string
  baseVersion: number
  payload: ResolveEntry['payload']
  createdAt: string
}): ResolveEntry {
  return {
    clientId: `rsv-${input.sampleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sampleId: input.sampleId,
    kind: 'resolve',
    createdAt: input.createdAt,
    baseVersion: input.baseVersion,
    syncState: 'pending',
    payload: input.payload,
  }
}

/** 把一条本地决定覆盖到 proposals 视图上 */
export function applyDecisionToSample<T extends { proposals: { id: string; status: string }[] }>(
  sample: T,
  decision: { proposalId: string; decision: DecisionValue },
): T {
  const proposal = sample.proposals.find((item) => item.id === decision.proposalId)
  if (proposal) proposal.status = decision.decision
  return sample
}
