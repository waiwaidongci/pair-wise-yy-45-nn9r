import type { AppDispatch, RootState } from '../app/store'
import type { Sample } from '../api/types'
import { uuid } from '../app/id'
import {
  closeVerify,
  markOpConflict,
  openVerify,
  removeOp,
  setKnownVersion,
  setLastSyncedAt,
  setOnline,
  setSnapshots,
  setSyncing,
  type Snapshot,
} from './offlineSlice'
import { addAnnotationLocal, decideProposalLocal, remoteSampleUpdated, syncLocked } from './developmentSlice'

type AppGetState = () => RootState
type ServerSample = Sample & { version?: number; snapshots?: Snapshot[] }

async function adoptSample(dispatch: AppDispatch, sample: ServerSample) {
  const { version, snapshots, ...clean } = sample
  dispatch(remoteSampleUpdated(clean))
  dispatch(syncLocked())
  if (typeof version === 'number') dispatch(setKnownVersion({ sampleId: clean.id, version }))
  if (snapshots) dispatch(setSnapshots({ sampleId: clean.id, snapshots }))
}

function reapplyPendingOps(dispatch: AppDispatch, getState: AppGetState, sampleId: string) {
  const ops = getState().offline.queue.filter((op) => op.sampleId === sampleId && op.status === 'pending')
  for (const op of ops) {
    if (op.type === 'annotation' && op.payload.annotation) {
      const annotation = op.payload.annotation
      const exists = getState()
        .development.samples.find((item) => item.id === sampleId)
        ?.annotations.some((item) => item.clientOpId === op.opId)
      if (!exists) {
        dispatch(
          addAnnotationLocal({
            sampleId,
            annotation: {
              ...annotation,
              id: `AN-${op.opId.slice(0, 8).toUpperCase()}`,
              author: '当前用户',
              status: '待处理',
            },
          }),
        )
      }
    } else if (op.type === 'decision' && op.payload.decision) {
      const decision = op.payload.decision
      const exists = getState().development.decisions.some(
        (item) => item.proposalId === decision.proposalId && item.decision === decision.decision,
      )
      if (!exists) {
        dispatch(decideProposalLocal({ sampleId, decision: { ...decision, decidedAt: new Date().toLocaleString('zh-CN') } }))
      }
    }
  }
}

export async function refreshSnapshots(dispatch: AppDispatch, getState: AppGetState) {
  const state = getState()
  if (!state.offline.online) return
  for (const sample of state.development.samples) {
    try {
      const res = await fetch(`/api/samples/${sample.id}/snapshots`)
      if (!res.ok) continue
      const snapshots = (await res.json()) as Snapshot[]
      dispatch(setSnapshots({ sampleId: sample.id, snapshots }))
    } catch {
      /* 离线时忽略，联网后再拉取 */
    }
  }
}

export async function flushQueue(dispatch: AppDispatch, getState: AppGetState) {
  const state = getState()
  const { queue, online } = state.offline
  if (!online || queue.length === 0) return
  dispatch(setSyncing(true))
  try {
    const pending = queue.filter((op) => op.status === 'pending')
    const bySample = new Map<string, typeof pending>()
    for (const op of pending) {
      const list = bySample.get(op.sampleId) ?? []
      list.push(op)
      bySample.set(op.sampleId, list)
    }
    for (const [sampleId, ops] of bySample) {
      const baseVersion = getState().offline.knownVersions[sampleId] ?? 1
      try {
        const res = await fetch(`/api/samples/${sampleId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseVersion,
            ops: ops.map(({ opId, type, payload }) => ({ opId, type, payload })),
          }),
        })
        if (res.status === 409) {
          const data = (await res.json()) as { currentVersion: number }
          for (const op of ops) {
            dispatch(
              markOpConflict({
                opId: op.opId,
                sampleId: op.sampleId,
                type: op.type,
                description: op.description,
                baseVersion,
                serverVersion: data.currentVersion,
                detectedAt: new Date().toISOString(),
              }),
            )
          }
          continue
        }
        if (!res.ok) continue
        const data = (await res.json()) as { sample: ServerSample; version: number }
        for (const op of ops) dispatch(removeOp(op.opId))
        await adoptSample(dispatch, data.sample)
        reapplyPendingOps(dispatch, getState, sampleId)
        dispatch(setLastSyncedAt(new Date().toISOString()))
      } catch {
        /* 网络失败：保留队列，等下次联网 */
      }
    }
  } finally {
    dispatch(setSyncing(false))
  }
}

export async function forceSyncOp(dispatch: AppDispatch, getState: AppGetState, opId: string) {
  const state = getState()
  const op = state.offline.queue.find((item) => item.opId === opId)
  if (!op) return
  const baseVersion = state.offline.knownVersions[op.sampleId] ?? 1
  try {
    const res = await fetch(`/api/samples/${op.sampleId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion,
        force: true,
        ops: [{ opId: op.opId, type: op.type, payload: op.payload }],
      }),
    })
    if (res.status === 409) {
      const data = (await res.json()) as { currentVersion: number }
      dispatch(
        markOpConflict({
          opId: op.opId,
          sampleId: op.sampleId,
          type: op.type,
          description: op.description,
          baseVersion,
          serverVersion: data.currentVersion,
          detectedAt: new Date().toISOString(),
        }),
      )
      return
    }
    if (!res.ok) return
    const data = (await res.json()) as { sample: ServerSample; version: number }
    dispatch(removeOp(op.opId))
    await adoptSample(dispatch, data.sample)
    reapplyPendingOps(dispatch, getState, op.sampleId)
    dispatch(setLastSyncedAt(new Date().toISOString()))
  } catch {
    /* 网络失败，保留待处理项 */
  }
}

export async function discardOp(dispatch: AppDispatch, getState: AppGetState, opId: string) {
  const state = getState()
  const op = state.offline.queue.find((item) => item.opId === opId)
  dispatch(removeOp(opId))
  if (!op) return
  try {
    const res = await fetch(`/api/samples/${op.sampleId}`)
    if (res.ok) {
      const data = (await res.json()) as ServerSample
      await adoptSample(dispatch, data)
      reapplyPendingOps(dispatch, getState, op.sampleId)
    }
  } catch {
    /* 放弃本地项即可 */
  }
}

export async function lockSample(dispatch: AppDispatch, getState: AppGetState, sampleId: string, note: string): Promise<'ok' | 'stale' | 'error' | 'offline'> {
  const state = getState()
  if (!state.offline.online) return 'offline'
  const baseVersion = state.offline.knownVersions[sampleId] ?? 1
  const lockId = uuid()
  try {
    const res = await fetch(`/api/samples/${sampleId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion, note, lockId }),
    })
    if (res.status === 409) {
      const data = (await res.json()) as { currentVersion: number }
      const freshRes = await fetch(`/api/samples/${sampleId}`)
      const fresh = freshRes.ok ? ((await freshRes.json()) as ServerSample) : null
      const working = getState().development.samples.find((item) => item.id === sampleId)
      dispatch(
        openVerify({
          sampleId,
          serverVersion: data.currentVersion,
          diff: fresh && working ? diffSamples(working, fresh) : ['服务器快照已更新，请重新核对。'],
        }),
      )
      return 'stale'
    }
    if (!res.ok) return 'error'
    const data = (await res.json()) as { sample: ServerSample; snapshot: Snapshot }
    await adoptSample(dispatch, data.sample)
    reapplyPendingOps(dispatch, getState, sampleId)
    dispatch(setSnapshots({ sampleId, snapshots: [...(getState().offline.snapshots[sampleId] ?? []), data.snapshot] }))
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function unlockSample(dispatch: AppDispatch, getState: AppGetState, sampleId: string) {
  const state = getState()
  if (!state.offline.online) return
  try {
    const res = await fetch(`/api/samples/${sampleId}/unlock`, { method: 'POST' })
    if (!res.ok) return
    const data = (await res.json()) as { sample: ServerSample }
    await adoptSample(dispatch, data.sample)
  } catch {
    /* 离线时无法解锁 */
  }
}

export async function verifySample(dispatch: AppDispatch, getState: AppGetState, sampleId: string) {
  try {
    const res = await fetch(`/api/samples/${sampleId}`)
    if (!res.ok) return
    const data = (await res.json()) as ServerSample
    await adoptSample(dispatch, data)
    reapplyPendingOps(dispatch, getState, sampleId)
    dispatch(closeVerify())
  } catch {
    /* 核对失败，保留对话框 */
  }
}

export function setOnlineStatus(dispatch: AppDispatch, online: boolean) {
  dispatch(setOnline(online))
}

function diffSamples(base: Sample, fresh: Sample): string[] {
  const diffs: string[] = []
  if (base.status !== fresh.status) diffs.push(`状态：${base.status} → ${fresh.status}`)
  const baseAnn = new Map(base.annotations.map((item) => [item.id, item]))
  for (const annotation of fresh.annotations) {
    const before = baseAnn.get(annotation.id)
    if (!before) {
      diffs.push(`新增批注：${annotation.part} · ${annotation.content.slice(0, 14)}`)
    } else if (before.content !== annotation.content || before.status !== annotation.status) {
      diffs.push(`批注变更：${annotation.part}（${before.status} → ${annotation.status}）`)
    }
  }
  for (const annotation of base.annotations) {
    if (!fresh.annotations.some((item) => item.id === annotation.id)) diffs.push(`批注删除：${annotation.part}`)
  }
  const baseProposal = new Map(base.proposals.map((item) => [item.id, item]))
  for (const proposal of fresh.proposals) {
    const before = baseProposal.get(proposal.id)
    if (before && before.status !== proposal.status) diffs.push(`方案决定：${proposal.affectedPart} → ${proposal.status}`)
  }
  const rounds = ['第一轮', '第二轮', '第三轮'] as const
  for (const round of rounds) {
    base.measurements[round].forEach((item, index) => {
      const after = fresh.measurements[round][index]
      if (after && after.actual !== item.actual) diffs.push(`尺寸变更：${round} ${item.name} ${item.actual} → ${after.actual}`)
    })
  }
  if (diffs.length === 0) diffs.push('未发现字段差异，仅版本号变化。')
  return diffs
}
