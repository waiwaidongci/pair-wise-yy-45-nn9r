import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Sample } from '../api/types'

export type PendingOpType = 'annotation' | 'decision'

export type PendingOp = {
  opId: string
  sampleId: string
  type: PendingOpType
  payload: {
    annotation?: { clientOpId: string; x: number; y: number; part: string; content: string }
    decision?: { proposalId: string; decision: '已采纳' | '未采纳'; reason: string }
  }
  description: string
  createdAt: string
  status: 'pending' | 'conflict'
}

export type ConflictRecord = {
  opId: string
  sampleId: string
  type: PendingOpType
  description: string
  baseVersion: number
  serverVersion: number
  detectedAt: string
}

export type Snapshot = {
  id: string
  version: number
  lockedAt: string
  note: string
  data: Sample
}

type OfflineState = {
  online: boolean
  syncing: boolean
  queue: PendingOp[]
  knownVersions: Record<string, number>
  conflicts: ConflictRecord[]
  snapshots: Record<string, Snapshot[]>
  lastSyncedAt: string | null
  verifySampleId: string | null
  verifyServerVersion: number | null
  verifyDiff: string[]
}

const storageKey = 'garment-sampling-offline-v1'

type PersistedOffline = Pick<OfflineState, 'queue' | 'knownVersions' | 'conflicts' | 'snapshots' | 'lastSyncedAt'>

function loadPersisted(): PersistedOffline {
  const empty: PersistedOffline = { queue: [], knownVersions: {}, conflicts: [], snapshots: {}, lastSyncedAt: null }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<PersistedOffline>
    return {
      queue: parsed.queue ?? [],
      knownVersions: parsed.knownVersions ?? {},
      conflicts: parsed.conflicts ?? [],
      snapshots: parsed.snapshots ?? {},
      lastSyncedAt: parsed.lastSyncedAt ?? null,
    }
  } catch {
    return empty
  }
}

const persisted = loadPersisted()

const initialState: OfflineState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  ...persisted,
  verifySampleId: null,
  verifyServerVersion: null,
  verifyDiff: [],
}

const slice = createSlice({
  name: 'offline',
  initialState,
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
    },
    setSyncing(state, action: PayloadAction<boolean>) {
      state.syncing = action.payload
    },
    enqueueOp(state, action: PayloadAction<PendingOp>) {
      if (state.queue.some((op) => op.opId === action.payload.opId)) return
      state.queue.push(action.payload)
    },
    removeOp(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((op) => op.opId !== action.payload)
      state.conflicts = state.conflicts.filter((item) => item.opId !== action.payload)
    },
    markOpConflict(state, action: PayloadAction<ConflictRecord>) {
      const op = state.queue.find((item) => item.opId === action.payload.opId)
      if (op) op.status = 'conflict'
      const existing = state.conflicts.find((item) => item.opId === action.payload.opId)
      if (existing) {
        existing.serverVersion = action.payload.serverVersion
        existing.detectedAt = action.payload.detectedAt
      } else {
        state.conflicts.push(action.payload)
      }
    },
    setKnownVersion(state, action: PayloadAction<{ sampleId: string; version: number }>) {
      state.knownVersions[action.payload.sampleId] = action.payload.version
    },
    setSnapshots(state, action: PayloadAction<{ sampleId: string; snapshots: Snapshot[] }>) {
      state.snapshots[action.payload.sampleId] = action.payload.snapshots
    },
    setLastSyncedAt(state, action: PayloadAction<string | null>) {
      state.lastSyncedAt = action.payload
    },
    openVerify(state, action: PayloadAction<{ sampleId: string; serverVersion: number; diff: string[] }>) {
      state.verifySampleId = action.payload.sampleId
      state.verifyServerVersion = action.payload.serverVersion
      state.verifyDiff = action.payload.diff
    },
    closeVerify(state) {
      state.verifySampleId = null
      state.verifyServerVersion = null
      state.verifyDiff = []
    },
  },
})

export const {
  setOnline,
  setSyncing,
  enqueueOp,
  removeOp,
  markOpConflict,
  setKnownVersion,
  setSnapshots,
  setLastSyncedAt,
  openVerify,
  closeVerify,
} = slice.actions

export const offlineReducer = slice.reducer

export const selectPendingCount = (state: { offline: OfflineState }, sampleId?: string) =>
  state.offline.queue.filter((op) => (sampleId ? op.sampleId === sampleId : true) && op.status === 'pending').length

export const selectConflictCount = (state: { offline: OfflineState }, sampleId?: string) =>
  state.offline.conflicts.filter((item) => (sampleId ? item.sampleId === sampleId : true)).length

export function selectReadSample(rootState: { development: { samples: Sample[] }; offline: OfflineState }, sampleId: string): Sample {
  const working = rootState.development.samples.find((item) => item.id === sampleId) ?? rootState.development.samples[0]
  if (working?.status === '已锁定') {
    const snapshots = rootState.offline.snapshots[sampleId]
    if (snapshots && snapshots.length > 0) return snapshots[snapshots.length - 1].data
  }
  return working
}
