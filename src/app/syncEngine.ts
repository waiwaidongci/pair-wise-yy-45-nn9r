import type { Store } from '@reduxjs/toolkit'
import { api, ConflictError, NetworkOfflineError } from './client'
import {
  hydrateSamples,
  markConflict,
  markPending,
  markSyncing,
  removeEntry,
  setLastSyncAt,
  setNotice,
  setSnapshots,
  upsertSample,
  type AnyQueueEntry,
} from '../features/syncSlice'
import type { AppDispatch, RootState } from './store'
import { timeLabel } from '../api/utils'
import type { RoundName } from '../api/types'
/**
 * 离线队列同步引擎：
 * - 断网时所有动作只入队（带 clientId 幂等键），刷新也不丢
 * - 重连后按 FIFO 冲刷；同一 clientId 服务器只认一份，重试不会变两份
 * - 409：保留本地条目并列出冲突，等人决定重放/丢弃，绝不悄悄覆盖
 * - 锁定前要求队列清空且 baseVersion 与服务器一致，否则拒绝并要求重新核对
 */
export class SyncEngine {
  private store: Store<RootState>
  private flushing = false
  private hydrating = false

  constructor(store: Store<RootState>) {
    this.store = store
  }

  get dispatch(): AppDispatch {
    return this.store.dispatch
  }

  isOnline(): boolean {
    const { online, manualOffline } = this.store.getState().sync
    return online && !manualOffline
  }

  /** 首次进入或重新核对：拉取服务器最新样衣与快照索引 */
  async hydrate(): Promise<boolean> {
    if (!this.isOnline() || this.hydrating) return false
    this.hydrating = true
    try {
      const [samples, snapshots] = await Promise.all([api.listSamples(), api.listSnapshots()])
      this.dispatch(hydrateSamples(samples))
      this.dispatch(setSnapshots(snapshots))
      this.dispatch(setLastSyncAt(timeLabel()))
      return true
    } catch (error) {
      if (error instanceof NetworkOfflineError) return false
      console.warn('[sync] hydrate failed', error)
      return false
    } finally {
      this.hydrating = false
    }
  }

  /** 冲刷整个待处理队列（重连、手动点击、新增动作后调用） */
  async flushQueue(): Promise<void> {
    if (!this.isOnline() || this.flushing) return
    this.flushing = true
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const state = this.store.getState().sync
        const entry = state.queue.find((item) => item.syncState === 'pending')
        if (!entry) break
        await this.flushEntry(entry)
      }
      const state = this.store.getState().sync
      if (!state.queue.some((item) => item.syncState !== 'conflict')) {
        this.dispatch(setLastSyncAt(timeLabel()))
      }
    } finally {
      this.flushing = false
    }
  }

  private async flushEntry(entry: AnyQueueEntry): Promise<void> {
    this.dispatch(markSyncing(entry.clientId))
    try {
      if (entry.kind === 'annotation') {
        const sample = await api.addAnnotation(entry.sampleId, entry.clientId, {
          ...entry.payload,
          baseVersion: entry.baseVersion,
        })
        this.dispatch(upsertSample(sample))
      } else if (entry.kind === 'decision') {
        const sample = await api.decide(entry.sampleId, entry.clientId, {
          ...entry.payload,
          baseVersion: entry.baseVersion,
        })
        this.dispatch(upsertSample(sample))
      } else {
        const sample = await api.resolveAnnotation(entry.sampleId, entry.payload.annotationId, entry.clientId, {
          status: entry.payload.status,
          baseVersion: entry.baseVersion,
        })
        this.dispatch(upsertSample(sample))
      }
      // 成功（含幂等重放）：条目出队
      this.dispatch(removeEntry(entry.clientId))
    } catch (error) {
      if (error instanceof ConflictError) {
        // 服务器已有新版本：先合并最新底本，再保留本地待处理项并列出冲突
        this.dispatch(upsertSample(error.body.sample))
        this.dispatch(
          markConflict({
            clientId: entry.clientId,
            conflicts: error.body.conflicts,
            message: error.body.message,
          }),
        )
        this.dispatch(
          setNotice({ severity: 'warning', text: `检测到 ${error.body.conflicts.length} 项冲突：服务器有更新版本，本地待处理项已保留，请核对后重放或丢弃。` }),
        )
      } else if (error instanceof NetworkOfflineError) {
        this.dispatch(markPending({ clientId: entry.clientId, message: '离线中，等待重连自动同步。' }))
      } else {
        const message = error instanceof Error ? error.message : '同步失败，稍后自动重试。'
        this.dispatch(markPending({ clientId: entry.clientId, message }))
      }
    }
  }

  /**
   * 审核锁定（必须在线）。
   * 前置：待处理队列清空（含未解决冲突）；快照未过期（baseVersion == 服务器版本）。
   */
  async lock(sampleId: string, round: RoundName, note: string): Promise<boolean> {
    if (!this.isOnline()) {
      this.dispatch(setNotice({ severity: 'warning', text: '当前离线，无法与服务器核对快照版本，审核锁定需联网后进行。' }))
      return false
    }
    const state = this.store.getState().sync
    if (state.queue.length > 0) {
      const conflicts = state.queue.filter((entry) => entry.syncState === 'conflict').length
      this.dispatch(
        setNotice({
          severity: 'warning',
          text: `待处理队列还有 ${state.queue.length} 项未清空${conflicts ? `（含 ${conflicts} 项冲突待决定）` : ''}，请全部同步或处理后再锁定。`,
        }),
      )
      return false
    }
    const cached = state.samplesCache.find((item) => item.id === sampleId)
    if (!cached) {
      this.dispatch(setNotice({ severity: 'error', text: '本地尚无样衣快照，请先联网核对最新数据。' }))
      return false
    }
    try {
      // 用服务器版本再核一次，防止缓存过期
      const fresh = await api.getSample(sampleId)
      this.dispatch(upsertSample(fresh))
      if (fresh.version !== cached.version) {
        this.dispatch(setNotice({ severity: 'warning', text: `快照已过期（本地 v${cached.version} / 服务器 v${fresh.version}），已载入最新版本，请重新核对后再锁定。` }))
        return false
      }
      const result = await api.lock(sampleId, { round, note, baseVersion: fresh.version })
      this.dispatch(upsertSample(result.sample))
      const snapshots = await api.listSnapshots()
      this.dispatch(setSnapshots(snapshots))
      this.dispatch(setNotice({ severity: 'success', text: `已锁定并生成审核快照 ${result.snapshot.id}（校验 ${result.snapshot.checksum}），总览、历史与导出读同一快照。` }))
      return true
    } catch (error) {
      const anyError = error as { body?: { sample?: typeof cached; message?: string } }
      if (anyError?.body?.sample) this.dispatch(upsertSample(anyError.body.sample))
      this.dispatch(setNotice({ severity: 'error', text: anyError?.body?.message ?? `锁定失败：${String(error)}` }))
      return false
    }
  }

  async unlock(sampleId: string): Promise<boolean> {
    if (!this.isOnline()) {
      this.dispatch(setNotice({ severity: 'warning', text: '当前离线，解锁需联网。原锁定快照在恢复联网后仍可查阅。' }))
      return false
    }
    try {
      const sample = await api.unlock(sampleId)
      this.dispatch(upsertSample(sample))
      const snapshots = await api.listSnapshots()
      this.dispatch(setSnapshots(snapshots))
      this.dispatch(setNotice({ severity: 'success', text: '已解锁并开启新的修订分支；原审核快照仍可在历史中查阅与导出。' }))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.dispatch(setNotice({ severity: 'error', text: `解锁失败：${message}` }))
      return false
    }
  }

  /** 演示用：模拟另一台设备在服务器上提交（制造版本冲突/过期） */
  async simulateRemote(sampleId: string): Promise<void> {
    if (!this.isOnline()) {
      this.dispatch(setNotice({ severity: 'warning', text: '请先恢复联网，再模拟远端更新。' }))
      return
    }
    try {
      const sample = await api.simulateRemote(sampleId)
      this.dispatch(upsertSample(sample))
      this.dispatch(setNotice({ severity: 'warning', text: `已模拟远端提交，服务器版本变为 v${sample.version}。你的本地待处理项重放时将出现冲突。` }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.dispatch(setNotice({ severity: 'error', text: message }))
    }
  }

  /** 导出走服务器上锁定时的同一份快照（带校验和） */
  async exportSnapshot(snapshotId: string): Promise<void> {
    if (!this.isOnline()) {
      this.dispatch(setNotice({ severity: 'warning', text: '当前离线无法导出快照；快照数据保存在服务器，恢复联网后可导出。' }))
      return
    }
    try {
      const data = await api.exportSnapshot(snapshotId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${data.styleCode}-${snapshotId}.json`
      link.click()
      URL.revokeObjectURL(url)
      this.dispatch(setNotice({ severity: 'success', text: `已导出快照 ${snapshotId}，校验和 ${data.checksum}（${data.checksumValid ? '一致' : '不一致'}）。` }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.dispatch(setNotice({ severity: 'error', text: `导出失败：${message}` }))
    }
  }

  /** 在线 / 离线切换时由 UI 层调用 */
  async handleConnectivityChange(): Promise<void> {
    if (this.isOnline()) {
      await this.hydrate()
      await this.flushQueue()
    }
  }
}
