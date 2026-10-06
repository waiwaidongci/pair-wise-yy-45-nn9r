import { useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import SyncIcon from '@mui/icons-material/Sync'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import WifiTetheringErrorIcon from '@mui/icons-material/WifiTetheringError'
import { useAppSelector } from '../app/hooks'
import { useSync } from '../app/sync'
import type { AnyQueueEntry } from '../features/syncSlice'

const kindLabel: Record<AnyQueueEntry['kind'], string> = {
  annotation: '部位批注',
  decision: '方案决定',
  resolve: '批注关闭',
}

export default function SyncCenter() {
  const sync = useSync()
  const samplesCache = useAppSelector((state) => state.sync.samplesCache)
  const [open, setOpen] = useState(false)

  const pendingCount = sync.queue.filter((entry) => entry.syncState === 'pending' || entry.syncState === 'syncing').length
  const conflictCount = sync.queue.filter((entry) => entry.syncState === 'conflict').length

  return (
    <>
      <Box sx={{ mx: 1.5, p: 1.5, border: '1px solid rgba(255,255,255,.12)', borderRadius: 1.5, bgcolor: sync.online ? 'rgba(116,183,157,.08)' : 'rgba(207,114,70,.14)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          {sync.online ? <CloudDoneIcon sx={{ fontSize: 16, color: '#74b79d' }} /> : <CloudOffIcon sx={{ fontSize: 16, color: '#e08a5c' }} />}
          <Typography fontSize={11} fontWeight={700} color={sync.online ? '#9ad3bd' : '#f0b18b'}>
            {sync.online ? '在线 · 服务器已连接' : '离线 · 本地记录中'}
          </Typography>
        </Box>
        <Typography color="#8f9a98" fontSize={10} mt={0.8}>
          {sync.online
            ? `最后同步 ${sync.lastSyncAt ?? '尚未同步'}`
            : `待处理队列 ${sync.queue.length} 项，重连自动补交`}
        </Typography>

        <Stack direction="row" spacing={0.8} mt={1} flexWrap="wrap" useFlexGap>
          <Tooltip title={sync.online ? '模拟断网（供应商现场）' : '恢复联网并同步'}>
            <Button
              size="small"
              color={sync.online ? 'warning' : 'success'}
              variant="outlined"
              sx={{ fontSize: 10, py: 0.2, minWidth: 0 }}
              onClick={() => sync.setManualOffline(!sync.manualOffline)}
            >
              {sync.manualOffline ? '恢复联网' : '模拟断网'}
            </Button>
          </Tooltip>
          <Tooltip title="查看待处理队列与冲突">
            <IconButton size="small" onClick={() => setOpen(true)} sx={{ color: '#cfd8d5', p: 0.3 }}>
              <Badge badgeContent={pendingCount + conflictCount} color={conflictCount ? 'error' : 'warning'}>
                {conflictCount ? <WarningAmberIcon fontSize="small" /> : <SyncIcon fontSize="small" />}
              </Badge>
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>待处理队列 · 离线同步</DialogTitle>
        <DialogContent>
          <Alert severity={sync.online ? 'success' : 'info'} sx={{ mb: 1.5 }}>
            {sync.online
              ? `在线。队列条目带幂等键，补交多次也只会在服务器保留一份。`
              : '离线中。所有记录已保存在本机，刷新页面也不会丢失，重连后自动同步。'}
          </Alert>

          {sync.queue.length === 0 ? (
            <Typography color="text.secondary" fontSize={13} py={2} textAlign="center">
              队列为空，没有待补交的批注或方案决定。
            </Typography>
          ) : (
            <Stack spacing={1.2}>
              {sync.queue.map((entry) => {
                const sample = samplesCache.find((item) => item.id === entry.sampleId)
                return (
                  <Box key={entry.clientId} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1.2, borderLeft: `3px solid ${entry.syncState === 'conflict' ? '#c2492f' : entry.syncState === 'syncing' ? '#2d7b72' : '#d49a4e'}` }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box>
                        <Typography fontWeight={800} fontSize={13}>
                          {kindLabel[entry.kind]} · {sample?.styleCode ?? entry.sampleId}
                        </Typography>
                        <Typography color="text.secondary" fontSize={11}>
                          {entry.createdAt} · 基于快照 v{entry.baseVersion}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={entry.syncState === 'conflict' ? '冲突待决定' : entry.syncState === 'syncing' ? '同步中' : '待同步'}
                        color={entry.syncState === 'conflict' ? 'error' : entry.syncState === 'syncing' ? 'success' : 'warning'}
                      />
                    </Stack>

                    <Box mt={0.8}>
                      {entry.kind === 'annotation' && (
                        <Typography fontSize={12}>「{entry.payload.part}」{entry.payload.content}</Typography>
                      )}
                      {entry.kind === 'decision' && (
                        <Typography fontSize={12}>
                          方案 {entry.payload.proposalId}：{entry.payload.decision} — {entry.payload.reason}
                        </Typography>
                      )}
                      {entry.kind === 'resolve' && (
                        <Typography fontSize={12}>批注 {entry.payload.annotationId} 标记为{entry.payload.status}</Typography>
                      )}
                    </Box>

                    {entry.syncState === 'conflict' && entry.conflicts && (
                      <Box mt={1}>
                        {entry.conflicts.map((conflict, index) => (
                          <Alert key={index} severity="warning" icon={<WifiTetheringErrorIcon fontSize="inherit" />} sx={{ py: 0.3, mb: 0.6, '& .MuiAlert-message': { fontSize: 11 } }}>
                            <strong>服务器：</strong>{conflict.remote}
                            <br />
                            <strong>本地：</strong>{conflict.local}
                          </Alert>
                        ))}
                        <Typography color="text.secondary" fontSize={10.5} mb={0.6}>
                          本地待处理项不会被自动覆盖。请重新核对后选择重放（基于最新版本再提交）或丢弃本地记录。
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="contained" disabled={!sync.online} onClick={() => void sync.recheckConflict(entry.clientId)}>
                            重新核对并重放
                          </Button>
                          <Button size="small" color="inherit" onClick={() => sync.discardEntry(entry.clientId)}>
                            丢弃本地项
                          </Button>
                        </Stack>
                      </Box>
                    )}
                    {entry.syncState === 'pending' && entry.lastError && (
                      <Typography color="#a85d38" fontSize={10.5} mt={0.6}>{entry.lastError}</Typography>
                    )}
                  </Box>
                )
              })}
            </Stack>
          )}

          <Divider sx={{ my: 1.5 }} />
          <Typography color="text.secondary" fontSize={11}>
            幂等键（同一条记录补交多次不会变成两份）：
          </Typography>
          <Box sx={{ maxHeight: 70, overflow: 'auto', mt: 0.5 }}>
            {sync.queue.map((entry) => (
              <Typography key={entry.clientId} fontFamily="monospace" fontSize={9.5} color="#9a948e" noWrap>
                {entry.clientId}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>关闭</Button>
          <Button variant="contained" disabled={!sync.online || pendingCount === 0} startIcon={<SyncIcon />} onClick={() => void sync.retryAll()}>
            立即同步
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
