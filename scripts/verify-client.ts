/**
 * 客户端同步层验证（Redux store + SyncEngine + 合并视图）：
 * - 断网入队、刷新（持久化）不丢
 * - 重连自动同步、冲突保留本地项并列出、rebase 重放
 * - 队列未清空时锁定被拒
 */
import './shim'

import { setupServer } from 'msw/node'
import { handlers } from '../src/api/handlers'
import { store } from '../src/app/store'
import { SyncEngine } from '../src/app/syncEngine'
import { mergeSample } from '../src/app/data'
import { setManualOffline } from '../src/features/syncSlice'

const server = setupServer(...handlers)
let passed = 0
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`)
  passed++
  console.log(`  ✓ ${message}`)
}

server.listen({ onUnhandledRequest: 'error' })
try {
  const engine = new SyncEngine(store)
  const sampleId = 'SMP-26018'

  console.log('场景 A：首次联网拉取')
  assert(await engine.hydrate(), 'hydrate 成功')
  let state = store.getState().sync
  assert(state.samplesCache.length === 2, '缓存 2 个样衣')
  const baseVersion = state.samplesCache.find((s) => s.id === sampleId)!.version

  console.log('场景 B：断网后就地记录，刷新不丢')
  store.dispatch(setManualOffline(true))
  assert(engine.isOnline() === false, '引擎识别为离线')
  // 通过引擎上层动作不方便（在 React hook 里），直接用 dispatch + 队列构造器
  const { enqueue, makeAnnotationEntry, makeDecisionEntry } = await import('../src/features/syncSlice')
  const { nowLabel } = await import('../src/api/utils')
  store.dispatch(enqueue(makeAnnotationEntry({
    sampleId,
    baseVersion,
    localAnnotationId: 'local-AN-test-1',
    payload: { x: 20, y: 30, part: '袖窿', content: '断网现场批注 A', round: '第三轮' },
    createdAt: nowLabel(),
  })))
  await engine.flushQueue()
  state = store.getState().sync
  assert(state.queue.length === 1, '离线时 flush 不发送，条目保留在队列')
  assert(state.queue[0].syncState === 'pending', '条目状态为待同步')

  // 合并视图：离线期间页面也能看到刚加的批注
  const offlineView = mergeSample(state.samplesCache.find((s) => s.id === sampleId), state.queue)!
  assert(offlineView.annotations.some((a) => a.id === 'local-AN-test-1'), '合并视图乐观显示本地批注')
  assert(offlineView.annotations.filter((a) => a.content === '断网现场批注 A').length === 1, '本地批注只出现一次')

  // 模拟刷新：持久化内容里必须能找到队列
  const persisted = JSON.parse(localStorage.getItem('garment-sampling-sync-v2')!)
  assert(persisted.queue.length === 1 && persisted.queue[0].localAnnotationId === 'local-AN-test-1', 'localStorage 已持久化待处理队列（刷新不丢）')

  console.log('场景 C：重连即自动同步')
  store.dispatch(setManualOffline(false))
  await engine.handleConnectivityChange()
  state = store.getState().sync
  assert(state.queue.length === 0, '重连后队列清空')
  const synced = store.getState().sync.samplesCache.find((s) => s.id === sampleId)!
  assert(synced.version === baseVersion + 1, `服务器缓存版本前推（v${baseVersion} → v${synced.version}）`)
  assert(synced.annotations.some((a) => a.content === '断网现场批注 A'), '服务器数据包含已同步批注')

  console.log('场景 D：服务器已有更新版本 → 409 冲突，本地项保留、列出冲突，不悄悄覆盖')
  // 先入队一条基于当前版本的决定（离线），再让远端改动版本
  const beforeRemote = store.getState().sync.samplesCache.find((s) => s.id === sampleId)!.version
  store.dispatch(setManualOffline(true))
  store.dispatch(enqueue(makeDecisionEntry({
    sampleId,
    baseVersion: beforeRemote,
    payload: { proposalId: 'RV-01', decision: '已采纳', reason: '离线现场决定' },
    createdAt: nowLabel(),
  })))
  // 另一台设备提交（直接打服务器）
  const { api } = await import('../src/app/client')
  const remote = await api.simulateRemote(sampleId)
  assert(remote.version === beforeRemote + 1, '远端把版本前推')
  // 本地缓存仍旧（离线 hydrate 不会跑）
  assert(store.getState().sync.samplesCache.find((s) => s.id === sampleId)!.version === beforeRemote, '离线期间本地缓存未被远端改动')

  store.dispatch(setManualOffline(false))
  await engine.handleConnectivityChange()
  state = store.getState().sync
  const conflictEntry = state.queue.find((e) => e.kind === 'decision')
  assert(conflictEntry?.syncState === 'conflict', '离线决定重放时标记为冲突而非被覆盖')
  assert((conflictEntry?.conflicts?.length ?? 0) >= 1, '冲突条目附带冲突明细')
  assert(state.samplesCache.find((s) => s.id === sampleId)!.version === remote.version, '冲突后已载入服务器最新底本')
  const conflictView = mergeSample(state.samplesCache.find((s) => s.id === sampleId), state.queue)!
  assert(conflictView.annotations.some((a) => a.author.includes('远端设备')), '合并视图显示远端更新')
  const rv01 = conflictView.proposals.find((p) => p.id === 'RV-01')!
  assert(rv01.status === '已采纳', '本地待处理决定仍以乐观状态保留（等人决定，不被悄悄覆盖）')

  console.log('场景 E：重新核对后重放 → 成功出队')
  // RV-01 在服务器上仍是待决定，rebase 到最新版本后可以写入
  const { rebaseEntry } = await import('../src/features/syncSlice')
  store.dispatch(rebaseEntry({ clientId: conflictEntry!.clientId, baseVersion: remote.version }))
  await engine.flushQueue()
  state = store.getState().sync
  assert(state.queue.length === 0, '冲突经重新核对重放后出队')
  const afterReplay = state.samplesCache.find((s) => s.id === sampleId)!
  assert(afterReplay.proposals.find((p) => p.id === 'RV-01')!.status === '已采纳', '服务器记录了采纳决定')
  assert(afterReplay.decisions.some((d) => d.reason === '离线现场决定'), '决定理由进入服务器审计记录')

  console.log('场景 F：待处理队列未清空时拒绝锁定')
  store.dispatch(setManualOffline(true))
  store.dispatch(enqueue(makeAnnotationEntry({
    sampleId,
    baseVersion: afterReplay.version,
    localAnnotationId: 'local-AN-test-2',
    payload: { x: 1, y: 1, part: '局部', content: '又一条离线记录', round: '第三轮' },
    createdAt: nowLabel(),
  })))
  const lockedWhilePending = await engine.lock(sampleId, '第三轮', 'test')
  assert(lockedWhilePending === false, '离线且队列非空时锁定被拒绝')
  assert(Boolean(store.getState().sync.notice?.text), `给出拒绝原因：${store.getState().sync.notice?.text ?? ''}`)

  // 恢复联网（队列仍在）→ 命中“队列未清空”门槛
  store.dispatch(setManualOffline(false))
  const lockedWhilePendingOnline = await engine.lock(sampleId, '第三轮', 'test')
  assert(lockedWhilePendingOnline === false, '在线但队列非空时仍拒绝锁定')
  assert(store.getState().sync.notice?.text.includes('待处理队列'), '拒绝原因明确提示先清空待处理队列')

  // 丢弃后队列清空（该样衣本身还有待处理批注，会被服务器以 400 拒绝，这里只验证队列门槛）
  const { removeEntry } = await import('../src/features/syncSlice')
  store.dispatch(removeEntry(store.getState().sync.queue[0].clientId))
  const lockedWithOpenItems = await engine.lock(sampleId, '第三轮', 'test')
  assert(lockedWithOpenItems === false, '队列清空但仍有未关闭批注时，服务器同样拒绝锁定')
  assert(store.getState().sync.notice?.text.includes('待处理'), '提示仍需关闭待处理批注/方案')

  console.log(`\n全部 ${passed} 项客户端断言通过 ✅`)
} finally {
  server.close()
}
