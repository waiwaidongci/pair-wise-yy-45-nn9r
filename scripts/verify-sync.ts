/**
 * 端到端行为验证（Node + msw/node）：
 * 1. 离线入队两条 → 重连冲刷 → 服务器只有一条新批注（幂等）
 * 2. 同一 clientId 重放 → 不产生两份
 * 3. 服务器版本更新后旧 baseVersion 提交 → 409 + 冲突明细，本地项保留
 * 4. 待处理队列未清空不能锁（客户端逻辑）；baseVersion 过期服务器拒绝锁定
 * 5. 锁定后总览/历史/导出读同一快照（checksum 一致），解锁后快照仍可查
 */
import { setupServer } from 'msw/node'
import { handlers } from '../src/api/handlers'
import { checksum } from '../src/api/utils'

const server = setupServer(...handlers)

let passed = 0
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`)
  passed++
  console.log(`  ✓ ${message}`)
}

async function postJson(url: string, body: unknown, clientId?: string) {
  const absolute = url.startsWith('http') ? url : `http://msw.local${url}`
  return fetch(absolute, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(clientId ? { 'X-Client-Id': clientId } : {} ) },
    body: JSON.stringify(body),
  })
}

server.listen({ onUnhandledRequest: 'error' })
try {
  console.log('场景 1：首次拉取')
  const listRes = await fetch('http://msw.local/api/samples')
  const samples = (await listRes.json()) as Array<{ id: string; version: number }>
  assert(samples.length === 2, '种子包含 2 个样衣')
  const sampleId = samples[0].id
  assert(samples[0].version === 1, '初始版本为 v1')

  console.log('场景 2：同一条离线记录“补交两次”（相同 clientId）只能有一份')
  const clientId = 'fixed-client-id-001'
  const annotationPayload = { x: 30, y: 40, part: '袖窿', content: '离线现场批注：袖窿上提 0.5cm', round: '第三轮', baseVersion: 1 }
  const first = await postJson(`/api/samples/${sampleId}/annotations`, annotationPayload, clientId)
  assert(first.status === 201, '首次提交 201')
  const afterFirst = (await first.json()) as { version: number; annotations: unknown[] }
  assert(afterFirst.version === 2, '版本推进到 v2')
  const second = await postJson(`/api/samples/${sampleId}/annotations`, annotationPayload, clientId)
  assert(second.status === 201, '相同幂等键重放仍返回原 201')
  const afterSecond = (await second.json()) as { version: number; annotations: Array<{ content: string }> }
  const dupCount = afterSecond.annotations.filter((a) => a.content === annotationPayload.content).length
  assert(dupCount === 1, `服务器只有 1 条该批注（实际 ${dupCount}），不会变两份`)
  assert(afterSecond.version === 2, '幂等重放不推进版本')

  console.log('场景 3：服务器有更新版本时，旧 baseVersion 的提交 → 409 冲突且不覆盖')
  const remote = await postJson(`/api/samples/${sampleId}/simulate-remote`, {})
  const remoteSample = (await remote.json()) as { version: number }
  assert(remoteSample.version === 3, '远端更新把版本推到 v3')
  const stale = await postJson(`/api/samples/${sampleId}/annotations`, {
    x: 10, y: 10, part: '下摆', content: '本地旧快照上的批注', baseVersion: 2,
  }, 'local-queue-item-x')
  assert(stale.status === 409, '旧版本提交被拒绝 409')
  const conflictBody = (await stale.json()) as { conflicts: unknown[]; sample: { version: number } }
  assert(Array.isArray(conflictBody.conflicts) && conflictBody.conflicts.length === 1, '返回冲突明细供人工核对')
  assert(conflictBody.sample.version === 3, '冲突响应附带服务器最新样衣')
  const checkAgain = await (await fetch(`http://msw.local/api/samples/${sampleId}`)).json() as {
    annotations: Array<{ content: string }>
  }
  assert(!checkAgain.annotations.some((a) => a.content === '本地旧快照上的批注'), '本地待处理项没有被悄悄写进服务器')

  console.log('场景 4：基于最新版本重放 → 成功')
  const replay = await postJson(`/api/samples/${sampleId}/annotations`, {
    x: 10, y: 10, part: '下摆', content: '本地旧快照上的批注', baseVersion: 3,
  }, 'local-queue-item-x-rebased')
  assert(replay.status === 201, '重新核对后以 v3 为基体重放成功')

  console.log('场景 5：锁定前置校验')
  // baseVersion 过期 → 拒绝锁定
  const staleLock = await postJson(`/api/samples/${sampleId}/lock`, { round: '第三轮', note: '尝试用旧快照锁定', baseVersion: 1 })
  assert(staleLock.status === 409, '快照过期时服务器拒绝锁定')
  const staleLockBody = (await staleLock.json()) as { error: string }
  assert(staleLockBody.error === 'snapshot_stale', '错误类型 snapshot_stale，要求重新核对')

  console.log('场景 6：用样衣 2 走完整锁定 → 快照同源 → 解锁后旧快照仍可查')
  const s2 = samples[1].id
  // 仍有待处理项 → 400
  const pendingLock = await postJson(`/api/samples/${s2}/lock`, { round: '第三轮', note: '', baseVersion: 1 })
  assert(pendingLock.status === 400, '有待处理批注/方案时拒绝锁定')

  // 关闭批注 + 决定方案
  const s2detail = (await (await fetch(`http://msw.local/api/samples/${s2}`)).json()) as {
    annotations: Array<{ id: string }>
    proposals: Array<{ id: string }>
  }
  const annId = s2detail.annotations[0].id
  const propId = s2detail.proposals[0].id
  await postJson(`/api/samples/${s2}/annotations/${annId}/resolve`, { status: '已解决', baseVersion: 1 }, 'resolve-1')
  await postJson(`/api/samples/${s2}/decisions`, { proposalId: propId, decision: '已采纳', reason: '压线方案可行', baseVersion: 2 }, 'decide-1')
  const beforeLock = (await (await fetch(`http://msw.local/api/samples/${s2}`)).json()) as { version: number }
  const lockRes = await postJson(`/api/samples/${s2}/lock`, { round: '第三轮', note: '资料完整，定版', baseVersion: beforeLock.version })
  assert(lockRes.status === 201, '队列清空且版本一致 → 锁定成功')
  const lockBody = (await lockRes.json()) as { sample: { version: number; lockedSnapshotId: string; status: string }; snapshot: { id: string; checksum: string } }
  assert(lockBody.sample.status === '已锁定', '样衣状态已锁定')
  const snapshotId = lockBody.snapshot.id
  assert(lockBody.sample.lockedSnapshotId === snapshotId, '样衣记录关联当前快照 id')

  // 锁定后写操作被拒
  const writeOnLocked = await postJson(`/api/samples/${s2}/annotations`, { x: 1, y: 1, part: 'x', content: 'x', baseVersion: lockBody.sample.version }, 'ann-locked')
  assert(writeOnLocked.status === 409, '锁定后新增批注被拒绝')

  // 总览读、快照读、导出读同一份
  const overviewSample = (await (await fetch(`http://msw.local/api/samples/${s2}`)).json()) as { lockedSnapshotId: string }
  const snapshotDetail = (await (await fetch(`http://msw.local/api/snapshots/${snapshotId}`)).json()) as { checksum: string; sample: unknown }
  const exported = (await (await fetch(`http://msw.local/api/snapshots/${snapshotId}/export`)).json()) as { checksum: string; checksumValid: boolean }
  assert(overviewSample.lockedSnapshotId === snapshotId, '总览接口指向锁定快照')
  assert(exported.checksum === snapshotDetail.checksum, '导出与历史快照 checksum 相同')
  assert(exported.checksumValid === true, '快照内容校验通过（同源未被篡改）')
  assert(checksum(snapshotDetail.sample) === snapshotDetail.checksum, '重新计算 checksum 与快照记录一致')

  // 解锁 → 旧快照仍可查/可导出
  const unlockRes = await postJson(`/api/samples/${s2}/unlock`, {})
  assert(unlockRes.status === 200, '解锁成功，开启新分支')
  const unlocked = (await unlockRes.json()) as { status: string; lockedSnapshotId?: string }
  assert(unlocked.status === '待审核' && unlocked.lockedSnapshotId === undefined, '解锁后样衣回到待审核')
  const oldSnapshot = await fetch(`http://msw.local/api/snapshots/${snapshotId}`)
  assert(oldSnapshot.status === 200, '原锁定快照解锁后仍可查阅')
  const oldExport = await fetch(`http://msw.local/api/snapshots/${snapshotId}/export`)
  assert(oldExport.status === 200, '原锁定快照解锁后仍可导出')
  const summaries = (await (await fetch('http://msw.local/api/snapshots')).json()) as Array<{ id: string; superseded: boolean }>
  assert(summaries.some((s) => s.id === snapshotId && s.superseded === true), '快照列表保留旧快照并标记为历史快照')

  // 解锁后版本前推，重新锁定时旧 baseVersion 必须被拒
  const staleRelock = await postJson(`/api/samples/${s2}/lock`, { round: '第三轮', note: '', baseVersion: beforeLock.version })
  assert(staleRelock.status === 409, '解锁后再锁定，旧快照版本同样被拒绝')

  console.log(`\n全部 ${passed} 项断言通过 ✅`)
} finally {
  server.close()
}
