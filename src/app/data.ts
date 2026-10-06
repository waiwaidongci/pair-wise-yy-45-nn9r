import { useMemo } from 'react'
import type { Annotation, Decision, Sample, ServerSample } from '../api/types'
import { useAppSelector } from './hooks'
import type { AnyQueueEntry, AnnotationEntry, DecisionEntry } from '../features/syncSlice'

/**
 * 页面读取的统一视图：
 * 以服务器（或其持久化缓存）为底本，叠加本地待处理队列的乐观更新。
 * 冲突条目仍然叠加显示，保证“先保留本地待处理项”。
 */
export function mergeSample(server: ServerSample | undefined, queue: AnyQueueEntry[]): Sample | null {
  if (!server) return null
  // 结构化克隆：绝不就地修改缓存，否则会造成“悄悄覆盖”
  const sample: Sample = structuredClone(server)
  const entries = queue.filter((entry) => entry.sampleId === server.id)

  for (const entry of entries) {
    if (entry.kind === 'annotation') {
      mergeAnnotation(sample, entry)
    } else if (entry.kind === 'decision') {
      mergeDecision(sample, entry)
    } else if (entry.kind === 'resolve') {
      mergeResolve(sample, entry)
    }
  }
  return sample
}

function mergeAnnotation(sample: Sample, entry: AnnotationEntry) {
  // 幂等保护：服务器返回里已带相同 clientId 标记时不再重复添加
  const already = sample.annotations.some((item) => item.id === entry.localAnnotationId)
  if (!already) {
    const annotation: Annotation = {
      id: entry.localAnnotationId,
      author: '当前评审员（本地）',
      status: '待处理',
      ...entry.payload,
    }
    sample.annotations.push(annotation)
  }
}

function mergeDecision(sample: Sample, entry: DecisionEntry) {
  const { proposalId, decision, reason } = entry.payload
  const proposal = sample.proposals.find((item) => item.id === proposalId)
  if (proposal) proposal.status = decision
  const existing = sample.decisions.find((item) => item.proposalId === proposalId && item.clientId === entry.clientId)
  if (!existing) {
    const record: Decision = {
      proposalId,
      decision,
      reason,
      decidedAt: entry.createdAt,
      author: '当前评审员（本地）',
      clientId: entry.clientId,
    }
    sample.decisions.push(record)
  }
}

function mergeResolve(sample: Sample, entry: AnyQueueEntry) {
  if (entry.kind !== 'resolve') return
  const annotation = sample.annotations.find((item) => item.id === entry.payload.annotationId)
  if (annotation) annotation.status = entry.payload.status
}

/** 选择某个样衣的合并视图；无服务器缓存时返回 null */
export function selectMergedSample(samplesCache: ServerSample[], queue: AnyQueueEntry[], id: string): Sample | null {
  return mergeSample(samplesCache.find((item) => item.id === id), queue)
}

export function useMergedSamples(): Sample[] {
  const samplesCache = useAppSelector((state) => state.sync.samplesCache)
  const queue = useAppSelector((state) => state.sync.queue)
  return useMemo(() => samplesCache.map((server) => mergeSample(server, queue)!), [samplesCache, queue])
}

export function useMergedSample(id: string): Sample | null {
  const samplesCache = useAppSelector((state) => state.sync.samplesCache)
  const queue = useAppSelector((state) => state.sync.queue)
  return useMemo(() => selectMergedSample(samplesCache, queue, id), [samplesCache, queue, id])
}
