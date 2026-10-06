import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LockOutlineIcon from '@mui/icons-material/LockOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import { useAppSelector } from '../app/hooks'
import { useMergedSample } from '../app/data'
import { useSync } from '../app/sync'

export default function HistoryPage() {
  const state = useAppSelector((root) => root.development)
  const sample = useMergedSample(state.selectedId)
  const sync = useSync()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lockNote, setLockNote] = useState('')
  const [locking, setLocking] = useState(false)

  const pendingAnnotations = sample?.annotations.filter((item) => item.status === '待处理').length ?? 0
  const pendingProposals = sample?.proposals.filter((item) => item.status === '待决定').length ?? 0
  const locked = sample?.status === '已锁定'

  const queueForSample = sync.queue.filter((entry) => entry.sampleId === state.selectedId)
  const queueBlocked = queueForSample.length > 0

  const relatedSnapshots = useMemo(
    () => sync.snapshots.filter((snapshot) => snapshot.sampleId === state.selectedId),
    [sync.snapshots, state.selectedId],
  )
  const currentSnapshot = relatedSnapshots.find((snapshot) => snapshot.id === sample?.lockedSnapshotId)

  const canLock = sample != null && pendingAnnotations === 0 && pendingProposals === 0 && !queueBlocked

  const events = sample
    ? [
        ...sample.events.map((event) => ({ date: event.at, title: event.title, owner: event.owner, detail: event.detail, status: event.status })),
        ...sample.decisions.map((item) => ({
          date: item.decidedAt,
          title: `方案 ${item.proposalId} ${item.decision}`,
          owner: item.author,
          detail: item.reason,
          status: item.clientId ? '本地决定已同步' : '已记录',
        })),
      ]
    : []

  if (!sample) {
    return <Box className="page"><Alert severity="info">正在加载历史数据…</Alert></Box>
  }

  const confirmLock = async () => {
    setLocking(true)
    const ok = await sync.lock(state.roundB, lockNote || `确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`)
    setLocking(false)
    if (ok) {
      setConfirmOpen(false)
      setLockNote('')
    }
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">
            锁定会生成不可覆盖的服务器快照；总览、历史与导出读同一份。解锁后原快照仍可在此查阅。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {currentSnapshot && (
            <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={() => void sync.exportSnapshot(currentSnapshot.id)}>
              导出当前快照
            </Button>
          )}
          {locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={() => void sync.unlock(sample.id)}>解锁修订</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={() => setConfirmOpen(true)} disabled={!canLock || !sync.online}>
              审核锁定
            </Button>
          )}
        </Stack>
      </Box>

      {!sync.online && !locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          离线中：锁定必须联网与服务器核对版本。批注和决定已在本机记录，重连同步并清空队列后才能锁定。
        </Alert>
      )}
      {!locked && queueBlocked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          待处理队列还有 {queueForSample.length} 项未清空
          （{queueForSample.filter((entry) => entry.syncState === 'conflict').length} 项冲突待决定）。
          只有队列清空后才允许审核锁定——未同步的批注和决定不能被锁进旧快照。
        </Alert>
      )}
      {!locked && !queueBlocked && (pendingAnnotations > 0 || pendingProposals > 0) && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注和 {pendingProposals} 项待决定改版方案。
        </Alert>
      )}
      {locked && currentSnapshot && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          当前轮次已锁定。快照 {currentSnapshot.id} · 生成于 {currentSnapshot.createdAt} · 校验和 {currentSnapshot.checksum}。
          总览、历史与导出读的是同一份冻结数据；解锁后该快照仍可在下方列表查阅与导出。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 330px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线</Typography>
            <Chip size="small" variant="outlined" label={`基于 v${sample.version}${locked ? ' 快照冻结' : ''}`} />
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: { xs: '110px', sm: '150px' } }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '24px 1fr' }}>
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
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={1.5}>
          <Box className="panel">
            <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
              <Typography fontWeight={800}>轮次摘要</Typography>
            </Box>
            <Stack spacing={1.2} p={1.6}>
              {(['第一轮', '第二轮', '第三轮'] as const).map((round, index) => (
                <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: round === state.roundB ? '#edf5f2' : '#fff' }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                    <Chip size="small" label={index === 2 ? sample.status : '已归档'} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={11} mt={0.8}>
                    {sample.measurements[round].length} 项实测 · {index === 2 ? sample.annotations.length : index + 2} 条评审记录
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box className="panel">
            <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4', display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Inventory2OutlinedIcon fontSize="small" color="primary" />
              <Typography fontWeight={800}>审核快照</Typography>
            </Box>
            {relatedSnapshots.length === 0 ? (
              <Typography color="text.secondary" fontSize={12} p={1.6}>暂无锁定快照。锁定后此处保留每一轮的冻结版本，解锁也不会删除。</Typography>
            ) : (
              <List dense disablePadding>
                {relatedSnapshots.map((snapshot) => {
                  const active = snapshot.id === sample.lockedSnapshotId
                  return (
                    <ListItemButton
                      key={snapshot.id}
                      selected={active}
                      sx={{ flexDirection: 'column', alignItems: 'stretch', borderBottom: '1px solid #f0eeea' }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <ListItemText
                          primary={<Typography fontSize={12.5} fontWeight={800} fontFamily="monospace">{snapshot.id}</Typography>}
                          secondary={<Typography fontSize={10.5}>{snapshot.round} · {snapshot.createdAt}</Typography>}
                        />
                        {active ? (
                          <Chip size="small" color="success" label="当前" />
                        ) : snapshot.superseded ? (
                          <Chip size="small" variant="outlined" label="历史快照" />
                        ) : null}
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                        <Typography fontSize={10} color="#8a918d" fontFamily="monospace">checksum {snapshot.checksum} · v{snapshot.version}</Typography>
                        <Button size="small" startIcon={<DownloadOutlinedIcon />} onClick={() => void sync.exportSnapshot(snapshot.id)}>
                          导出
                        </Button>
                      </Stack>
                    </ListItemButton>
                  )
                })}
              </List>
            )}
          </Box>
        </Stack>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>
            锁定前会向服务器核对：待处理队列为空，且本地版本（v{sample.version}）与服务器一致。
            若服务器已有更新版本，将拒绝锁定并要求重新核对，绝不把旧数据锁成快照。
          </Typography>
          <TextField fullWidth multiline minRows={2} label="锁定说明" defaultValue={`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`} onChange={(event) => setLockNote(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={locking}>取消</Button>
          <Button variant="contained" disabled={!canLock || locking} onClick={() => void confirmLock()}>
            {locking ? '正在核对并锁定…' : '确认锁定'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
