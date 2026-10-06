import { useEffect } from 'react'
import { Alert, Box, Button, Collapse } from '@mui/material'
import { useSync } from '../app/sync'

/** 顶部全局提示：离线横幅 + 同步引擎发出的通知（冲突、锁定拒绝、快照过期等） */
export default function GlobalNotice() {
  const sync = useSync()

  useEffect(() => {
    if (!sync.notice) return
    const timer = setTimeout(() => sync.clearNotice(), 9000)
    return () => clearTimeout(timer)
  }, [sync.notice, sync])

  return (
    <Box>
      <Collapse in={!sync.online}>
        <Alert
          severity="warning"
          variant="filled"
          sx={{ borderRadius: 0, alignItems: 'center' }}
          action={
            <Button color="inherit" size="small" onClick={() => sync.setManualOffline(false)}>
              重试连接
            </Button>
          }
        >
          当前处于离线状态（供应商现场网络中断）。批注与方案决定保存在本机待处理队列，刷新不丢；重连后自动补交，同一记录不会变成两份。
        </Alert>
      </Collapse>
      <Collapse in={Boolean(sync.notice)}>
        {sync.notice && (
          <Alert
            severity={sync.notice.severity}
            onClose={() => sync.clearNotice()}
            sx={{ borderRadius: 0 }}
          >
            {sync.notice.text}
          </Alert>
        )}
      </Collapse>
    </Box>
  )
}
