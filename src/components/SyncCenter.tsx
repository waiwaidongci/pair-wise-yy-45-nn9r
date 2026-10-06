import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { store } from '../app/store'
import {
  discardOp,
  flushQueue,
  forceSyncOp,
  lockSample,
  refreshSnapshots,
  verifySample,
} from '../features/syncEngine'
import { closeVerify, setOnline } from '../features/offlineSlice'

export default function SyncCenter() {
  const dispatch = useAppDispatch()
  const online = useAppSelector((state) => state.offline.online)
  const syncing = useAppSelector((state) => state.offline.syncing)
  const conflicts = useAppSelector((state) => state.offline.conflicts)
  const verifySampleId = useAppSelector((state) => state.offline.verifySampleId)
  const verifyServerVersion = useAppSelector((state) => state.offline.verifyServerVersion)
  const verifyDiff = useAppSelector((state) => state.offline.verifyDiff)
  const samples = useAppSelector((state) => state.development.samples)
  const knownVersions = useAppSelector((state) => state.offline.knownVersions)
  const [verifyNote, setVerifyNote] = useState('核对差异后重新锁定')

  useEffect(() => {
    const goOnline = () => dispatch(setOnline(true))
    const goOffline = () => dispatch(setOnline(false))
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    dispatch(setOnline(navigator.onLine))
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [dispatch])

  useEffect(() => {
    if (online) flushQueue(store.dispatch, store.getState)
  }, [online])

  useEffect(() => {
    refreshSnapshots(store.dispatch, store.getState)
  }, [])

  const sampleName = (sampleId: string) => {
    const sample = samples.find((item) => item.id === sampleId)
    return sample ? `${sample.styleCode} ${sample.styleName}` : sampleId
  }

  const handleVerifyAndLock = async () => {
    if (!verifySampleId) return
    await verifySample(store.dispatch, store.getState, verifySampleId)
    await lockSample(store.dispatch, store.getState, verifySampleId, verifyNote)
  }

  return (
    <>
      <Dialog open={conflicts.length > 0} onClose={() => undefined} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <WarningAmberOutlinedIcon color="warning" />
            <Typography fontWeight={800}>同步冲突：服务器已有更新版本</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            以下本地待处理项基于旧版本快照，服务器已有更新版本。本地内容已保留，不会被悄悄覆盖；请逐项选择处理方式。
          </Alert>
          <Stack spacing={1.2}>
            {conflicts.map((conflict) => (
              <Box key={conflict.opId} sx={{ p: 1.3, border: '1px solid #e2dfda', borderRadius: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                  <Typography fontWeight={800} fontSize={13}>{conflict.description}</Typography>
                  <Chip size="small" label={`${sampleName(conflict.sampleId)} · v${conflict.baseVersion} → v${conflict.serverVersion}`} color="warning" />
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.5}>
                  类型：{conflict.type === 'annotation' ? '批注' : '方案决定'} · 检测于 {new Date(conflict.detectedAt).toLocaleString('zh-CN')}
                </Typography>
                <Stack direction="row" spacing={1} mt={1}>
                  <Button size="small" variant="contained" onClick={() => forceSyncOp(store.dispatch, store.getState, conflict.opId)}>
                    保留本地并重新提交
                  </Button>
                  <Button size="small" color="inherit" onClick={() => discardOp(store.dispatch, store.getState, conflict.opId)}>
                    采用服务器版本
                  </Button>
                </Stack>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => conflicts.forEach((item) => forceSyncOp(store.dispatch, store.getState, item.opId))}
            disabled={syncing}
          >
            全部保留本地
          </Button>
          <Button
            color="inherit"
            onClick={() => conflicts.forEach((item) => discardOp(store.dispatch, store.getState, item.opId))}
          >
            全部采用服务器
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(verifySampleId)} onClose={() => dispatch(closeVerify())} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <CloudOffOutlinedIcon color="warning" />
            <Typography fontWeight={800}>快照已过期，锁定被拒绝</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            服务器快照已更新到 v{verifyServerVersion ?? '-'}，你本地基于 v{verifySampleId ? (knownVersions[verifySampleId] ?? 1) : '-'}。
            锁定前必须重新核对差异，否则锁定会被拒绝。
          </Alert>
          <Typography fontWeight={800} fontSize={13} mb={0.8}>差异核对</Typography>
          <Box sx={{ bgcolor: '#f8f7f4', borderRadius: 1, p: 1.2, mb: 1.5 }}>
            {verifyDiff.map((line, index) => (
              <Typography key={index} fontSize={12} color={line.includes('新增') || line.includes('变更') ? '#b44b2d' : 'text.secondary'}>
                · {line}
              </Typography>
            ))}
          </Box>
          <Divider sx={{ my: 1 }} />
          <TextField
            fullWidth
            size="small"
            label="锁定说明"
            value={verifyNote}
            onChange={(event) => setVerifyNote(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => dispatch(closeVerify())}>取消</Button>
          <Button
            variant="contained"
            startIcon={<SyncOutlinedIcon />}
            onClick={handleVerifyAndLock}
          >
            重新核对并锁定
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function SyncStatus() {
  const online = useAppSelector((state) => state.offline.online)
  const syncing = useAppSelector((state) => state.offline.syncing)
  const queueCount = useAppSelector((state) => state.offline.queue.length)
  const conflictCount = useAppSelector((state) => state.offline.conflicts.length)
  const lastSyncedAt = useAppSelector((state) => state.offline.lastSyncedAt)

  return (
    <Box sx={{ mx: 1.5, mt: 'auto', p: 1.5, border: '1px solid rgba(255,255,255,.1)', borderRadius: 1.5 }}>
      <Stack direction="row" alignItems="center" gap={0.7}>
        {online ? <CloudDoneOutlinedIcon sx={{ fontSize: 16, color: '#74b79d' }} /> : <CloudOffOutlinedIcon sx={{ fontSize: 16, color: '#e0a06a' }} />}
        <Typography fontSize={11}>{online ? '在线 · 草稿自动同步' : '离线 · 就地记录'}</Typography>
      </Stack>
      <Stack direction="row" gap={0.6} mt={0.8} flexWrap="wrap">
        <Chip size="small" label={`待同步 ${queueCount}`} color={queueCount ? 'warning' : 'default'} sx={{ height: 20, fontSize: 10 }} />
        <Chip size="small" label={`冲突 ${conflictCount}`} color={conflictCount ? 'error' : 'default'} sx={{ height: 20, fontSize: 10 }} />
      </Stack>
      <Button
        fullWidth
        size="small"
        variant="outlined"
        sx={{ mt: 1, color: '#eef1ef', borderColor: 'rgba(255,255,255,.25)', fontSize: 11 }}
        startIcon={<SyncOutlinedIcon sx={{ fontSize: 14 }} />}
        disabled={!online || syncing || queueCount === 0}
        onClick={() => flushQueue(store.dispatch, store.getState)}
      >
        {syncing ? '同步中…' : '立即同步'}
      </Button>
      <Typography color="#8f9a98" fontSize={10} mt={0.8}>最后同步 {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '尚未同步'}</Typography>
    </Box>
  )
}
