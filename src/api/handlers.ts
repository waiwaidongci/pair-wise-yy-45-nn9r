import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type {
  Annotation,
  ConflictBody,
  ConflictItem,
  Decision,
  IdempotencyRecord,
  ServerSample,
  SnapshotDetail,
  SnapshotSummary,
} from './types'
import { checksum, nowLabel } from './utils'

let samples = structuredClone(seedSamples)
const snapshots: SnapshotDetail[] = []
const idempotency = new Map<string, IdempotencyRecord>()

const CURRENT_USER = '当前评审员'

function findSample(id: string | undefined) {
  return samples.find((item) => item.id === id)
}

function bump(sample: ServerSample) {
  sample.version += 1
  sample.updatedAt = nowLabel()
}

function json(record: IdempotencyRecord) {
  return new HttpResponse(JSON.stringify(record.body), {
    status: record.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 构建 409 冲突明细：本地动作基于的版本与服务器当前版本不一致 */
function conflictResponse(sample: ServerSample, kind: 'annotation' | 'decision' | 'resolve', body: {
  baseVersion: number
  proposalId?: string
  annotationId?: string
  part?: string
  content?: string
  decision?: string
  reason?: string
  status?: string
}) {
  const conflicts: ConflictItem[] = []
  if (sample.status === '已锁定') {
    conflicts.push({
      kind,
      reason: 'sample_locked',
      local: describeLocal(kind, body),
      remote: `服务器快照 ${sample.lockedSnapshotId} 已锁定，轮次只读`,
      proposalId: body.proposalId,
      annotationId: body.annotationId,
    })
  } else if (kind === 'decision' && body.proposalId) {
    const proposal = sample.proposals.find((item) => item.id === body.proposalId)
    if (proposal && proposal.status !== '待决定') {
      conflicts.push({
        kind,
        reason: 'proposal_decided',
        local: describeLocal(kind, body),
        remote: `服务器上该方案已被决定为「${proposal.status}」`,
        proposalId: body.proposalId,
      })
    }
  } else if (kind === 'resolve' && body.annotationId) {
    const annotation = sample.annotations.find((item) => item.id === body.annotationId)
    if (annotation && annotation.status === '已解决') {
      conflicts.push({
        kind,
        reason: 'annotation_resolved',
        local: describeLocal(kind, body),
        remote: '服务器上该批注已被其他评审员关闭',
        annotationId: body.annotationId,
      })
    }
  }
  if (conflicts.length === 0) {
    conflicts.push({
      kind,
      reason: 'sample_changed',
      local: describeLocal(kind, body),
      remote: `服务器已有新版本 v${sample.version}（本地基于 v${body.baseVersion}）`,
      proposalId: body.proposalId,
      annotationId: body.annotationId,
    })
  }
  const payload: ConflictBody = {
    error: 'conflict',
    message:
      sample.status === '已锁定'
        ? '该轮次已锁定，本地修改无法写入，已保留在待处理队列。'
        : `服务器版本已更新到 v${sample.version}，本地动作基于旧快照 v${body.baseVersion}，已保留本地待处理项，请核对后决定重放或丢弃。`,
    sample: structuredClone(sample),
    conflicts,
  }
  return HttpResponse.json(payload, { status: 409 })
}

function describeLocal(kind: string, body: { part?: string; content?: string; decision?: string; reason?: string; status?: string }) {
  if (kind === 'annotation') return `本地批注「${body.part ?? ''}」：${body.content ?? ''}`
  if (kind === 'decision') return `本地方案决定：${body.decision ?? ''}（${body.reason ?? ''}）`
  return `本地批注状态变更：${body.status ?? ''}`
}

export const handlers = [
  http.get('*/api/samples', () => HttpResponse.json(samples)),

  http.get('*/api/samples/:id', ({ params }) => {
    const sample = findSample(params.id as string)
    return sample ? HttpResponse.json(sample) : new HttpResponse(null, { status: 404 })
  }),

  http.post('*/api/samples/:id/annotations', async ({ params, request }) => {
    const clientId = request.headers.get('X-Client-Id') ?? ''
    const remembered = idempotency.get(clientId)
    if (remembered) return json(remembered)

    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as { x: number; y: number; part: string; content: string; round?: Annotation['round']; baseVersion: number }

    if (sample.status === '已锁定' || body.baseVersion !== sample.version) {
      return conflictResponse(sample, 'annotation', body)
    }

    const annotation: Annotation = {
      id: `AN-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      x: body.x,
      y: body.y,
      part: body.part,
      content: body.content,
      author: CURRENT_USER,
      round: body.round,
      status: '待处理',
    }
    sample.annotations.push(annotation)
    sample.events.unshift({
      id: `EV-${Date.now()}`,
      at: nowLabel(),
      type: 'annotation',
      title: `${annotation.part}批注`,
      owner: annotation.author,
      detail: annotation.content,
      status: '待处理',
    })
    bump(sample)
    const record: IdempotencyRecord = { clientId, status: 201, body: structuredClone(sample) }
    idempotency.set(clientId, record)
    return json(record)
  }),

  http.post('*/api/samples/:id/annotations/:aid/resolve', async ({ params, request }) => {
    const clientId = request.headers.get('X-Client-Id') ?? ''
    const remembered = idempotency.get(clientId)
    if (remembered) return json(remembered)

    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as { status: Annotation['status']; baseVersion: number }
    const annotation = sample.annotations.find((item) => item.id === params.aid)
    if (!annotation) return new HttpResponse(null, { status: 404 })

    if (sample.status === '已锁定' || body.baseVersion !== sample.version) {
      return conflictResponse(sample, 'resolve', { ...body, annotationId: annotation.id })
    }

    annotation.status = body.status
    sample.events.unshift({
      id: `EV-${Date.now()}`,
      at: nowLabel(),
      type: 'resolve',
      title: `${annotation.part}批注${body.status === '已解决' ? '关闭' : '重开'}`,
      owner: CURRENT_USER,
      detail: annotation.content,
      status: body.status,
    })
    bump(sample)
    const record: IdempotencyRecord = { clientId, status: 200, body: structuredClone(sample) }
    idempotency.set(clientId, record)
    return json(record)
  }),

  http.post('*/api/samples/:id/decisions', async ({ params, request }) => {
    const clientId = request.headers.get('X-Client-Id') ?? ''
    const remembered = idempotency.get(clientId)
    if (remembered) return json(remembered)

    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as { proposalId: string; decision: Decision['decision']; reason: string; baseVersion: number }
    const proposal = sample.proposals.find((item) => item.id === body.proposalId)
    if (!proposal) return new HttpResponse(null, { status: 404 })

    if (sample.status === '已锁定' || body.baseVersion !== sample.version) {
      return conflictResponse(sample, 'decision', body)
    }

    proposal.status = body.decision
    const decision: Decision = {
      proposalId: body.proposalId,
      decision: body.decision,
      reason: body.reason,
      decidedAt: nowLabel(),
      author: CURRENT_USER,
      clientId,
    }
    sample.decisions.push(decision)
    sample.events.unshift({
      id: `EV-${Date.now()}`,
      at: decision.decidedAt,
      type: 'decision',
      title: `${proposal.affectedPart}方案${body.decision}`,
      owner: CURRENT_USER,
      detail: body.reason,
      status: body.decision,
    })
    bump(sample)
    const record: IdempotencyRecord = { clientId, status: 201, body: structuredClone(sample) }
    idempotency.set(clientId, record)
    return json(record)
  }),

  http.post('*/api/samples/:id/lock', async ({ params, request }) => {
    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const body = (await request.json().catch(() => ({}))) as { round?: string; note?: string; baseVersion?: number }

    // 快照过期：本地基于的版本落后于服务器，拒绝锁定
    if (typeof body.baseVersion === 'number' && body.baseVersion !== sample.version) {
      return HttpResponse.json(
        {
          error: 'snapshot_stale',
          message: `本地快照 v${body.baseVersion} 已过期，服务器为 v${sample.version}。请先重新核对最新数据再锁定。`,
          sample: structuredClone(sample),
        },
        { status: 409 },
      )
    }

    const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理')
    const pendingProposals = sample.proposals.filter((item) => item.status === '待决定')
    if (pendingAnnotations.length || pendingProposals.length) {
      return HttpResponse.json(
        {
          error: 'pending_remaining',
          message: `仍有 ${pendingAnnotations.length} 项待处理批注、${pendingProposals.length} 项待决定方案，不能锁定。`,
          pendingAnnotations: pendingAnnotations.map((item) => item.id),
          pendingProposals: pendingProposals.map((item) => item.id),
        },
        { status: 400 },
      )
    }
    if (sample.status === '已锁定') {
      return HttpResponse.json(
        { error: 'already_locked', message: '该轮次已锁定。', sample: structuredClone(sample) },
        { status: 400 },
      )
    }

    const frozen = structuredClone(sample)
    const snapshot: SnapshotDetail = {
      id: `SNAP-${sample.id.slice(-5)}-${Date.now().toString(36)}`,
      sampleId: sample.id,
      styleCode: sample.styleCode,
      round: (body.round as SnapshotDetail['round']) ?? '第三轮',
      createdAt: nowLabel(),
      note: body.note ?? '',
      checksum: checksum(frozen),
      version: sample.version + 1,
      superseded: false,
      sample: frozen,
    }
    snapshots.unshift(snapshot)
    sample.status = '已锁定'
    sample.lockedSnapshotId = snapshot.id
    sample.events.unshift({
      id: `EV-${Date.now()}`,
      at: snapshot.createdAt,
      type: 'lock',
      title: `${snapshot.round}审核锁定`,
      owner: CURRENT_USER,
      detail: `${snapshot.note}（快照 ${snapshot.id}）`,
      status: '已锁定',
    })
    bump(sample)
    const summary: SnapshotSummary = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'sample')) as SnapshotSummary
    return HttpResponse.json({ sample: structuredClone(sample), snapshot: summary }, { status: 201 })
  }),

  http.post('*/api/samples/:id/unlock', ({ params }) => {
    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    if (sample.status !== '已锁定') {
      return HttpResponse.json({ error: 'not_locked', message: '该轮次当前未锁定。' }, { status: 400 })
    }
    const snapshotId = sample.lockedSnapshotId
    // 原快照保留可查，只标记已被新分支接替
    const snapshot = snapshots.find((item) => item.id === snapshotId)
    if (snapshot) snapshot.superseded = true
    sample.status = '待审核'
    sample.lockedSnapshotId = undefined
    sample.events.unshift({
      id: `EV-${Date.now()}`,
      at: nowLabel(),
      type: 'unlock',
      title: '解锁修订',
      owner: CURRENT_USER,
      detail: `开启新的修订分支，历史快照 ${snapshotId ?? ''} 仍可查阅与导出。`,
      status: '解锁',
    })
    bump(sample)
    return HttpResponse.json(sample)
  }),

  http.get('*/api/snapshots', () =>
    HttpResponse.json(snapshots.map(({ sample: _sample, ...summary }) => summary))),

  http.get('*/api/snapshots/:id', ({ params }) => {
    const snapshot = snapshots.find((item) => item.id === params.id)
    if (!snapshot) return new HttpResponse(null, { status: 404 })
    // 校验快照未被篡改：总览、历史与导出读的是同一份
    if (checksum(snapshot.sample) !== snapshot.checksum) {
      return HttpResponse.json({ error: 'snapshot_corrupt', message: '快照校验失败。' }, { status: 409 })
    }
    return HttpResponse.json(snapshot)
  }),

  http.get('*/api/snapshots/:id/export', ({ params }) => {
    const snapshot = snapshots.find((item) => item.id === params.id)
    if (!snapshot) return new HttpResponse(null, { status: 404 })
    const recomputed = checksum(snapshot.sample)
    return HttpResponse.json({
      snapshotId: snapshot.id,
      sampleId: snapshot.sampleId,
      styleCode: snapshot.styleCode,
      round: snapshot.round,
      lockedAt: snapshot.createdAt,
      note: snapshot.note,
      checksum: snapshot.checksum,
      checksumValid: recomputed === snapshot.checksum,
      sample: snapshot.sample,
    })
  }),

  /** 演示用：模拟另一台设备/同事在服务器上提交了更新（版本前推），用于制造冲突场景 */
  http.post('*/api/samples/:id/simulate-remote', ({ params }) => {
    const sample = findSample(params.id as string)
    if (!sample) return new HttpResponse(null, { status: 404 })
    if (sample.status === '已锁定') {
      return HttpResponse.json({ error: 'locked', message: '已锁定轮次不接受远端改动。' }, { status: 400 })
    }
    const remote: Annotation = {
      id: `AN-R${Date.now().toString(36)}`,
      x: 28,
      y: 66,
      part: '袖口',
      content: '供应商现场补充：袖口建议增加 1cm 防滑条，已传工艺图。',
      author: '顾恺 / 质检（远端设备）',
      round: '第三轮',
      status: '待处理',
    }
    sample.annotations.push(remote)
    sample.events.unshift({
      id: `EV-R${Date.now()}`,
      at: nowLabel(),
      type: 'remote',
      title: `${remote.part}批注（远端提交）`,
      owner: remote.author,
      detail: remote.content,
      status: '待处理',
    })
    bump(sample)
    return HttpResponse.json(sample)
  }),
]
