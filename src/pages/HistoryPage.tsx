import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LockOutlineIcon from '@mui/icons-material/LockOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PhotoOutlinedIcon from '@mui/icons-material/PhotoOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { store } from '../app/store'
import { lockSample, unlockSample } from '../features/syncEngine'
import { selectPendingCount, selectReadSample, type Snapshot } from '../features/offlineSlice'

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const sample = useAppSelector((root) => selectReadSample(root, root.development.selectedId))
  const queuePending = useAppSelector((root) => selectPendingCount(root, sample.id))
  const snapshots = useAppSelector((root) => root.offline.snapshots[sample.id] ?? [])
  const online = useAppSelector((root) => root.offline.online)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)
  const [note, setNote] = useState(`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`)
  const [viewing, setViewing] = useState<Snapshot | null>(null)

  const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理').length
  const pendingProposals = sample.proposals.filter((item) => item.status === '待决定').length
  const canLock = pendingAnnotations === 0 && pendingProposals === 0 && queuePending === 0

  const events = [
    ...sample.annotations.map((item) => ({ date: '2026-09-27', title: `${item.part}批注`, owner: item.author, detail: item.content, status: item.status })),
    ...sample.proposals.map((item) => ({ date: '2026-09-27', title: `${item.affectedPart}改版方案`, owner: item.author, detail: item.content, status: item.status })),
    ...state.decisions.map((item) => ({ date: '今天', title: `方案 ${item.proposalId} ${item.decision}`, owner: '品类负责人', detail: item.reason, status: '已记录' })),
    { date: '2026-09-26', title: '第三轮尺寸实测导入', owner: '苏州明裁制衣', detail: '导入 6 个部位实测值，系统发现 2 项超过容差。', status: '已同步' },
    { date: '2026-09-22', title: '第二轮试穿评审', owner: '陈曼', detail: '完成动态试穿记录，肩袖活动量改善。', status: '已归档' },
  ]

  const handleLockClick = () => {
    if (queuePending > 0) {
      setWarnOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  const handleConfirmLock = async () => {
    const result = await lockSample(store.dispatch, store.getState, sample.id, note)
    if (result === 'ok' || result === 'stale') setConfirmOpen(false)
  }

  const handleUnlock = async () => {
    await unlockSample(store.dispatch, store.getState, sample.id)
  }

  const handleExport = () => {
    const snapshot = snapshots[snapshots.length - 1]
    const payload = {
      exportedAt: new Date().toISOString(),
      sample: { id: sample.id, styleCode: sample.styleCode, styleName: sample.styleName, status: sample.status },
      snapshot: snapshot ? { id: snapshot.id, version: snapshot.version, lockedAt: snapshot.lockedAt, note: snapshot.note } : null,
      data: snapshot ? snapshot.data : sample,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `修订快照_${sample.styleCode}_${snapshot ? snapshot.id : '未锁定'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">每次尺寸调整、批注和替代方案均保留时间、责任人与决定理由；锁定后总览、历史与导出读同一快照。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={handleExport}>导出修订记录</Button>
          {sample.status === '已锁定' ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={handleUnlock} disabled={!online}>解锁修订</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={handleLockClick} disabled={!canLock}>审核锁定</Button>
          )}
        </Stack>
      </Box>

      {queuePending > 0 && sample.status !== '已锁定' && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          有 {queuePending} 项批注/决定待同步，待处理队列清空后才能锁定。
        </Alert>
      )}
      {!canLock && sample.status !== '已锁定' && queuePending === 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注和 {pendingProposals} 项待决定改版方案。
        </Alert>
      )}
      {sample.status === '已锁定' && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          当前轮次已锁定，总览、历史与导出均读取同一快照。解锁后原快照仍可在此查看。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 310px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线</Typography>
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '92px 24px 1fr', gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 1px #25756d' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                    <Chip size="small" label={event.status} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{event.owner}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={1.5}>
          <Box className="panel" sx={{ p: 1.6 }}>
            <Typography fontWeight={800} mb={1}>轮次摘要</Typography>
            {(['第一轮', '第二轮', '第三轮'] as const).map((round, index) => (
              <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: round === state.roundB ? '#edf5f2' : '#fff', mb: index < 2 ? 1 : 0 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                  <Chip size="small" label={index === 2 ? sample.status : '已归档'} />
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.8}>
                  {sample.measurements[round].length} 项实测 · {index === 2 ? sample.annotations.length : index + 2} 条评审记录
                </Typography>
              </Box>
            ))}
          </Box>

          <Box className="panel" sx={{ p: 1.6 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <PhotoOutlinedIcon color="primary" fontSize="small" />
              <Typography fontWeight={800}>锁定快照</Typography>
            </Stack>
            {snapshots.length === 0 ? (
              <Typography color="text.secondary" fontSize={12}>尚未生成锁定快照。锁定后快照不可变，解锁后仍可查看。</Typography>
            ) : (
              <Stack spacing={1}>
                {snapshots.map((snapshot) => (
                  <Box key={snapshot.id} sx={{ p: 1.2, border: '1px solid #e4e1dc', borderRadius: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800} fontSize={12}>{snapshot.id}</Typography>
                      <Chip size="small" label={`v${snapshot.version}`} />
                    </Stack>
                    <Typography color="text.secondary" fontSize={11} mt={0.4}>
                      锁定于 {new Date(snapshot.lockedAt).toLocaleString('zh-CN')}
                    </Typography>
                    <Typography color="text.secondary" fontSize={11} mt={0.3}>说明：{snapshot.note || '—'}</Typography>
                    <Button size="small" sx={{ mt: 0.6 }} onClick={() => setViewing(snapshot)}>查看快照</Button>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>
            锁定后本轮尺寸、批注和采纳方案将变为只读，并生成不可覆盖的审核快照。若服务器快照已更新，锁定会被拒绝并要求重新核对。
          </Typography>
          <TextField fullWidth label="锁定说明" value={note} onChange={(event) => setNote(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleConfirmLock}>确认锁定</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={warnOpen} onClose={() => setWarnOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>待处理队列未清空</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1 }}>
            当前有 {queuePending} 项批注/决定尚未同步到服务器。离线记录已保存在本机，刷新或断网都不会丢失。
          </Alert>
          <Typography color="text.secondary" fontSize={13}>
            请先联网并点击侧栏「立即同步」，待处理队列清空后再锁定，以免锁定基于过期快照。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWarnOpen(false)}>知道了</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} fullWidth maxWidth="md">
        <DialogTitle>
          快照 {viewing?.id} · v{viewing?.version}
          <Typography color="text.secondary" fontSize={12} mt={0.3}>
            锁定于 {viewing ? new Date(viewing.lockedAt).toLocaleString('zh-CN') : ''} · 只读不可变
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {viewing && (
            <Stack spacing={1.5}>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>尺寸实测（{state.roundB}）</Typography>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <Box component="thead">
                    <Box component="tr" sx={{ bgcolor: '#f6f5f2' }}>
                      {['部位', '规格', '实测', '判定'].map((h) => (
                        <Box component="th" key={h} sx={{ textAlign: 'left', p: 0.6, border: '1px solid #e4e1dc' }}>{h}</Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {viewing.data.measurements[state.roundB].map((item) => {
                      const passed = Math.abs(item.actual - item.spec) <= item.tolerance
                      return (
                        <Box component="tr" key={item.key}>
                          <Box component="td" sx={{ p: 0.6, border: '1px solid #e4e1dc' }}>{item.name}</Box>
                          <Box component="td" sx={{ p: 0.6, border: '1px solid #e4e1dc' }}>{item.spec}</Box>
                          <Box component="td" sx={{ p: 0.6, border: '1px solid #e4e1dc' }}>{item.actual.toFixed(1)}</Box>
                          <Box component="td" sx={{ p: 0.6, border: '1px solid #e4e1dc', color: passed ? '#2d7665' : '#b44b2d' }}>{passed ? '达标' : '超差'}</Box>
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </Box>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>批注（{viewing.data.annotations.length}）</Typography>
                {viewing.data.annotations.map((annotation) => (
                  <Box key={annotation.id} sx={{ p: 0.8, borderLeft: '3px solid #397c69', bgcolor: '#f8f7f4', borderRadius: 1, mb: 0.6 }}>
                    <Typography fontSize={12} fontWeight={700}>{annotation.part} · {annotation.author}</Typography>
                    <Typography fontSize={12} color="text.secondary">{annotation.content}</Typography>
                  </Box>
                ))}
              </Box>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>改版方案（{viewing.data.proposals.length}）</Typography>
                {viewing.data.proposals.map((proposal) => (
                  <Box key={proposal.id} sx={{ p: 0.8, border: '1px solid #e4e1dc', borderRadius: 1, mb: 0.6 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography fontSize={12} fontWeight={700}>{proposal.affectedPart} · {proposal.role}</Typography>
                      <Chip size="small" label={proposal.status} />
                    </Stack>
                    <Typography fontSize={12} color="text.secondary">{proposal.content}</Typography>
                  </Box>
                ))}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
