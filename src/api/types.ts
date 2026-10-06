export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

export type RoundName = '第一轮' | '第二轮' | '第三轮'

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  content: string
  author: string
  round?: RoundName
  status: '待处理' | '已解决'
}

export type ProposalStatus = '待决定' | '已采纳' | '未采纳'
export type DecisionValue = Exclude<ProposalStatus, '待决定'>

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: ProposalStatus
}

export type SampleStatus = '开发中' | '待审核' | '已锁定'

export type Comment = { id: string; author: string; content: string; date: string }

export type AuditEvent = {
  id: string
  at: string
  type: 'annotation' | 'resolve' | 'decision' | 'comment' | 'lock' | 'unlock' | 'remote'
  title: string
  owner: string
  detail: string
  status: string
}

export type Decision = {
  proposalId: string
  decision: DecisionValue
  reason: string
  decidedAt: string
  author: string
  clientId?: string
}

/** 客户端视图：合并本地待处理队列后的样衣数据 */
export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: SampleStatus
  fabric: string
  colorway: string
  craft: string[]
  measurements: Record<RoundName, Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  decisions: Decision[]
  comments: Comment[]
  attachments: Array<{ name: string; type: string; owner: string }>
  events: AuditEvent[]
  /** 服务器版本号；本地缓存为 null 表示尚未与服务器对齐 */
  version: number | null
  updatedAt: string
  lockedSnapshotId?: string
}

/** 服务器侧样衣：version 必填 */
export type ServerSample = Omit<Sample, 'version'> & {
  version: number
}

export type SnapshotSummary = {
  id: string
  sampleId: string
  styleCode: string
  round: RoundName
  createdAt: string
  note: string
  checksum: string
  version: number
  superseded: boolean
}

export type SnapshotDetail = SnapshotSummary & {
  sample: ServerSample
}

export type IdempotencyRecord = {
  clientId: string
  status: number
  body: unknown
}

export type ConflictReason =
  | 'sample_changed'
  | 'annotation_resolved'
  | 'proposal_decided'
  | 'sample_locked'

export type ConflictItem = {
  kind: 'annotation' | 'decision' | 'resolve'
  reason: ConflictReason
  local: string
  remote: string
  proposalId?: string
  annotationId?: string
}

export type ConflictBody = {
  error: 'conflict'
  message: string
  sample: ServerSample
  conflicts: ConflictItem[]
}
