import { useMemo, useRef } from 'react'
import { useAppDispatch, useAppSelector } from './hooks'
import { store } from './store'
import { SyncEngine } from './syncEngine'
import {
  enqueue,
  makeAnnotationEntry,
  makeDecisionEntry,
  makeResolveEntry,
  rebaseEntry,
  removeEntry,
  setBrowserOnline,
  setManualOffline,
  setNotice,
} from '../features/syncSlice'
import { localId, nowLabel } from '../api/utils'
import type { Annotation, DecisionValue, RoundName } from '../api/types'

export const syncEngine = new SyncEngine(store)

/** 应用启动：监听浏览器在线/离线事件，初次拉取 */
export function bootstrapSync() {
  window.addEventListener('online', () => {
    store.dispatch(setBrowserOnline(true))
    void syncEngine.handleConnectivityChange()
  })
  window.addEventListener('offline', () => {
    store.dispatch(setBrowserOnline(false))
    store.dispatch(setNotice({ severity: 'warning', text: '网络已断开：批注与决定会保存在本机待处理队列，重连后自动同步。' }))
  })
  void syncEngine.hydrate().then(() => syncEngine.flushQueue())
}

export function useSync() {
  const dispatch = useAppDispatch()
  const sync = useAppSelector((state) => state.sync)
  const selectedId = useAppSelector((state) => state.development.selectedId)
  const flushingRef = useRef(false)

  return useMemo(() => {
    const effectiveOnline = sync.online && !sync.manualOffline

    /** 通用入队：断网或在线都先入队再冲刷，保证刷新不丢、重连补交幂等 */
    function queueThenFlush(build: () => void) {
      build()
      if (effectiveOnline) {
        if (flushingRef.current) return
        flushingRef.current = true
        queueMicrotask(() => {
          flushingRef.current = false
          void syncEngine.flushQueue()
        })
      }
    }

    return {
      online: effectiveOnline,
      browserOnline: sync.online,
      manualOffline: sync.manualOffline,
      lastSyncAt: sync.lastSyncAt,
      queue: sync.queue,
      samplesCache: sync.samplesCache,
      snapshots: sync.snapshots,
      notice: sync.notice,

      setManualOffline(value: boolean) {
        dispatch(setManualOffline(value))
        if (!value) setTimeout(() => void syncEngine.handleConnectivityChange(), 0)
      },

      clearNotice() {
        dispatch(setNotice(undefined))
      },

      addAnnotation(sampleId: string, baseVersion: number | null, payload: {
        x: number
        y: number
        part: string
        content: string
        round?: RoundName
      }) {
        // 从未联网过：版本按 1 之前的 0 处理，首次同步时若服务器已变更会被要求重新核对
        const version = baseVersion ?? 0
        const localAnnotationId = localId('AN')
        queueThenFlush(() => {
          dispatch(enqueue(makeAnnotationEntry({ sampleId, baseVersion: version, localAnnotationId, payload, createdAt: nowLabel() })))
        })
        return localAnnotationId
      },

      decide(sampleId: string, baseVersion: number | null, payload: {
        proposalId: string
        decision: DecisionValue
        reason: string
      }) {
        const version = baseVersion ?? 0
        queueThenFlush(() => {
          dispatch(enqueue(makeDecisionEntry({ sampleId, baseVersion: version, payload, createdAt: nowLabel() })))
        })
      },

      resolveAnnotation(sampleId: string, baseVersion: number | null, annotationId: string, status: Annotation['status']) {
        const version = baseVersion ?? 0
        queueThenFlush(() => {
          dispatch(enqueue(makeResolveEntry({ sampleId, baseVersion: version, payload: { annotationId, status }, createdAt: nowLabel() })))
        })
        if (effectiveOnline) setTimeout(() => void syncEngine.flushQueue(), 0)
      },

      retryAll() {
        // 把 pending/conflict 全部重置，再冲刷；conflict 项需先重新核对或丢弃
        void syncEngine.flushQueue()
      },

      /** 冲突：先拉最新服务器版本作为重放基线（保留本地待处理项） */
      async recheckConflict(clientId: string) {
        await syncEngine.hydrate()
        const entry = store.getState().sync.queue.find((item) => item.clientId === clientId)
        const fresh = store.getState().sync.samplesCache.find((item) => item.id === entry?.sampleId)
        if (entry && fresh) {
          dispatch(rebaseEntry({ clientId, baseVersion: fresh.version }))
          setTimeout(() => void syncEngine.flushQueue(), 0)
        }
      },

      /** 冲突：丢弃本地待处理项 */
      discardEntry(clientId: string) {
        dispatch(removeEntry(clientId))
      },

      lock(round: RoundName, note: string) {
        return syncEngine.lock(selectedId, round, note)
      },
      unlock(sampleId: string) {
        return syncEngine.unlock(sampleId)
      },
      simulateRemote(sampleId: string) {
        return syncEngine.simulateRemote(sampleId)
      },
      exportSnapshot(snapshotId: string) {
        return syncEngine.exportSnapshot(snapshotId)
      },
      hydrate() {
        return syncEngine.hydrate()
      },
    }
  }, [sync, dispatch, selectedId])
}
