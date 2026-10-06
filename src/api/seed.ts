import type { AuditEvent, Comment, ServerSample } from './types'

const measurements = (offset = 0) => [
  { key: 'chest', name: '胸围', spec: 108, actual: 108 + offset, tolerance: 1.5 },
  { key: 'waist', name: '腰围', spec: 94, actual: 94 + offset * 0.7, tolerance: 1.5 },
  { key: 'hem', name: '下摆围', spec: 112, actual: 112 + offset * 1.2, tolerance: 2 },
  { key: 'length', name: '后衣长', spec: 72, actual: 71.6 + offset, tolerance: 1 },
  { key: 'shoulder', name: '肩宽', spec: 48, actual: 48.3 + offset * 0.5, tolerance: 1 },
  { key: 'sleeve', name: '袖长', spec: 61, actual: 60.7 + offset, tolerance: 1 },
]

const comments018: Comment[] = [
  { id: 'CM-01', author: '陈曼', content: '袖窿活动量比第一轮改善，但抬手仍会带动前片。', date: '09-27 15:20' },
  { id: 'CM-02', author: '周研', content: '建议先采纳肩线修正方案，第三轮再确认动态舒适度。', date: '09-27 17:05' },
]

const events018: AuditEvent[] = [
  { id: 'EV-101', at: '2026-09-22 10:30', type: 'remote', title: '第二轮试穿评审', owner: '陈曼', detail: '完成动态试穿记录，肩袖活动量改善。', status: '已归档' },
  { id: 'EV-102', at: '2026-09-26 09:10', type: 'remote', title: '第三轮尺寸实测导入', owner: '苏州明裁制衣', detail: '导入 6 个部位实测值，系统发现 2 项超过容差。', status: '已同步' },
  { id: 'EV-103', at: '2026-09-27 14:05', type: 'annotation', title: '腰节批注', owner: '周研 / 版师', detail: '抽绳孔位比设计稿高 1.5cm，需要回落。', status: '已解决' },
  { id: 'EV-104', at: '2026-09-27 16:40', type: 'annotation', title: '领口批注', owner: '陈曼 / 产品', detail: '领尖略外翘，收窄 0.8cm 并增加领底衬。', status: '待处理' },
]

const events021: AuditEvent[] = [
  { id: 'EV-201', at: '2026-09-30 11:00', type: 'remote', title: '第一轮尺寸实测导入', owner: '宁波原野服饰', detail: '导入 6 个部位实测值，1 项接近容差上限。', status: '已同步' },
  { id: 'EV-202', at: '2026-10-05 15:20', type: 'annotation', title: '门襟批注', owner: '顾恺 / 质检', detail: '门襟压线偏移，检查模板定位。', status: '待处理' },
]

const baseSample = {
  version: 1,
  updatedAt: '2026-10-05 16:00',
  decisions: [] as ServerSample['decisions'],
  lockedSnapshotId: undefined as string | undefined,
}

export const seedSamples: ServerSample[] = [
  {
    ...baseSample,
    id: 'SMP-26018',
    styleCode: 'WR-26AW-018',
    styleName: '海盐弧线工装外套',
    category: '女装 / 外套',
    developmentSeason: '2026 秋冬',
    supplier: '苏州明裁制衣',
    dueDate: '2026-10-12',
    owner: '沈岚',
    status: '待审核',
    fabric: '三防棉锦 / 军绿色',
    colorway: '苔绿 18-0322 TCX',
    craft: ['斜向立体贴袋', '双针压线 0.6cm', '袖口暗扣'],
    measurements: {
      第一轮: measurements(2.6),
      第二轮: measurements(0.8),
      第三轮: measurements(0.3),
    },
    annotations: [
      { id: 'AN-01', x: 64, y: 24, part: '领口', content: '领尖略外翘，收窄 0.8cm 并增加领底衬。', author: '陈曼 / 产品', round: '第三轮', status: '待处理' },
      { id: 'AN-02', x: 42, y: 51, part: '腰节', content: '抽绳孔位比设计稿高 1.5cm，需要回落。', author: '周研 / 版师', round: '第二轮', status: '已解决' },
    ],
    proposals: [
      { id: 'RV-01', author: '周研', role: '版师', content: '前片肩线内收 0.6cm，袖窿同步下落 0.3cm。', affectedPart: '肩袖', status: '待决定' },
      { id: 'RV-02', author: '沈岚', role: '产品开发', content: '维持袖长，仅调整袖山吃势，避免改变视觉比例。', affectedPart: '袖山', status: '待决定' },
    ],
    comments: comments018,
    attachments: [
      { name: '第二轮正面.jpg', type: '样衣照片', owner: '沈岚' },
      { name: '尺寸实测_0926.xlsx', type: '尺寸表', owner: '苏州明裁' },
      { name: '试穿记录_试穿员B.pdf', type: '试穿记录', owner: '陈曼' },
    ],
    events: events018,
  },
  {
    ...baseSample,
    id: 'SMP-26021',
    styleCode: 'WR-26AW-021',
    styleName: '岩灰轻量风衣',
    category: '女装 / 风衣',
    developmentSeason: '2026 秋冬',
    supplier: '宁波原野服饰',
    dueDate: '2026-10-18',
    owner: '陈曼',
    status: '开发中',
    fabric: '高密尼龙 / 岩灰',
    colorway: '雾岩灰 17-4402 TCX',
    craft: ['隐形门襟', '后背防风片', '可拆腰带'],
    measurements: {
      第一轮: measurements(1.4),
      第二轮: measurements(0.4),
      第三轮: measurements(0),
    },
    annotations: [
      { id: 'AN-11', x: 54, y: 40, part: '门襟', content: '门襟压线偏移，检查模板定位。', author: '顾恺 / 质检', round: '第一轮', status: '待处理' },
    ],
    proposals: [
      { id: 'RV-11', author: '宁波原野', role: '供应商', content: '门襟增加定位钻眼，压线稳定性可控制在 ±0.2cm。', affectedPart: '门襟', status: '待决定' },
    ],
    comments: [],
    attachments: [{ name: '第一轮背片.jpg', type: '样衣照片', owner: '陈曼' }],
    events: events021,
  },
]
