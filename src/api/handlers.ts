import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type { Annotation, ReviewDecision, Sample } from './types'

export type SyncOp = {
  opId: string
  type: 'annotation' | 'decision'
  payload: {
    annotation?: Omit<Annotation, 'id' | 'author' | 'status'>
    decision?: Omit<ReviewDecision, 'decidedAt'> & { decidedAt?: string }
  }
}

export type ServerSnapshot = {
  id: string
  lockId?: string
  version: number
  lockedAt: string
  note: string
  data: Sample
}

export type ServerSample = Sample & {
  version: number
  snapshots: ServerSnapshot[]
  appliedOpIds: string[]
}

let samples: ServerSample[] = seedSamples.map((sample) => ({
  ...structuredClone(sample),
  version: 1,
  snapshots: [],
  appliedOpIds: [],
}))

const notFound = () => new HttpResponse(null, { status: 404 })

const bumpVersion = (sample: ServerSample, opIds: string[]) => {
  opIds.forEach((opId) => {
    if (!sample.appliedOpIds.includes(opId)) sample.appliedOpIds.push(opId)
  })
  sample.version += 1
}

function applyOp(sample: ServerSample, op: SyncOp) {
  if (op.type === 'annotation' && op.payload.annotation) {
    const annotation = op.payload.annotation
    sample.annotations.push({
      id: `AN-${shortId(op.opId)}`,
      author: '当前用户',
      status: '待处理',
      ...annotation,
    })
  } else if (op.type === 'decision' && op.payload.decision) {
    const decision = op.payload.decision
    const proposal = sample.proposals.find((item) => item.id === decision.proposalId)
    if (proposal) proposal.status = decision.decision
    sample.decisions = sample.decisions ?? []
    sample.decisions.push({
      proposalId: decision.proposalId,
      decision: decision.decision,
      reason: decision.reason,
      decidedAt: decision.decidedAt ?? new Date().toISOString(),
    })
  }
}

function shortId(opId: string) {
  return opId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()
}

export const handlers = [
  http.get('/api/samples', () => HttpResponse.json(samples)),

  http.get('/api/samples/:id', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample) : notFound()
  }),

  http.post('/api/samples/:id/annotations', async ({ params, request }) => {
    const body = (await request.json()) as { x: number; y: number; part: string; content: string; opId?: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    const opId = body.opId ?? `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!sample.appliedOpIds.includes(opId)) {
      sample.annotations.push({ id: `AN-${Date.now()}`, author: '当前用户', status: '待处理', ...body })
      bumpVersion(sample, [opId])
    }
    return HttpResponse.json(sample, { status: 201 })
  }),

  http.post('/api/samples/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string; opId?: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    const opId = body.opId ?? `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!sample.appliedOpIds.includes(opId)) {
      sample.comments.push({ id: `CM-${Date.now()}`, author: '当前用户', content: body.content, date: '刚刚' })
      bumpVersion(sample, [opId])
    }
    return HttpResponse.json(sample, { status: 201 })
  }),

  http.post('/api/samples/:id/sync', async ({ params, request }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    const body = (await request.json()) as { baseVersion: number; ops: SyncOp[]; force?: boolean }
    const newOps = body.ops.filter((op) => !sample.appliedOpIds.includes(op.opId))
    if (newOps.length === 0) {
      return HttpResponse.json({ sample, version: sample.version, appliedOpIds: body.ops.map((op) => op.opId) })
    }
    if (!body.force && body.baseVersion !== sample.version) {
      return HttpResponse.json(
        {
          currentVersion: sample.version,
          baseVersion: body.baseVersion,
          conflicts: newOps.map((op) => ({ opId: op.opId, type: op.type, reason: 'stale_version' })),
        },
        { status: 409 },
      )
    }
    const applied: string[] = []
    for (const op of newOps) {
      applyOp(sample, op)
      applied.push(op.opId)
    }
    if (applied.length > 0) bumpVersion(sample, applied)
    return HttpResponse.json({ sample, version: sample.version, appliedOpIds: body.ops.map((op) => op.opId) })
  }),

  http.post('/api/samples/:id/lock', async ({ params, request }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    const body = (await request.json()) as { baseVersion: number; note?: string; lockId?: string }
    if (body.lockId) {
      const existing = sample.snapshots.find((item) => item.lockId === body.lockId)
      if (existing) return HttpResponse.json({ sample, snapshot: existing }, { status: 200 })
    }
    if (body.baseVersion !== sample.version) {
      return HttpResponse.json(
        { error: 'stale_snapshot', currentVersion: sample.version, baseVersion: body.baseVersion },
        { status: 409 },
      )
    }
    const snapshot: ServerSnapshot = {
      id: `SN-${sample.id}-${sample.snapshots.length + 1}`,
      lockId: body.lockId,
      version: sample.version,
      lockedAt: new Date().toISOString(),
      note: body.note ?? '',
      data: structuredClone(sample),
    }
    sample.snapshots.push(snapshot)
    sample.status = '已锁定'
    sample.proposals.forEach((proposal) => {
      if (proposal.status === '待决定') proposal.status = '未采纳'
    })
    sample.version += 1
    return HttpResponse.json({ sample, snapshot }, { status: 201 })
  }),

  http.post('/api/samples/:id/unlock', async ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    sample.status = '待审核'
    sample.version += 1
    return HttpResponse.json({ sample })
  }),

  http.get('/api/samples/:id/snapshots', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample.snapshots) : notFound()
  }),

  http.get('/api/samples/:id/snapshots/:snapshotId', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return notFound()
    const snapshot = sample.snapshots.find((item) => item.id === params.snapshotId)
    return snapshot ? HttpResponse.json(snapshot) : notFound()
  }),
]
