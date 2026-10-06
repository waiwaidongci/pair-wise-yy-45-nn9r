import { configureStore } from '@reduxjs/toolkit'
import { developmentReducer } from '../features/developmentSlice'
import { syncReducer } from '../features/syncSlice'

const syncPersistKey = 'garment-sampling-sync-v2'
const uiPersistKey = 'garment-sampling-ui-v2'

export const store = configureStore({
  reducer: {
    development: developmentReducer,
    sync: syncReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // 冲突明细与队列条目都是普通 JSON，可安全持久化
        warnAfter: 100,
      },
    }),
})

let writeScheduled = false
store.subscribe(() => {
  if (writeScheduled) return
  writeScheduled = true
  queueMicrotask(() => {
    writeScheduled = false
    const state = store.getState()
    const { queue, samplesCache, snapshots, lastSyncAt, manualOffline } = state.sync
    localStorage.setItem(
      syncPersistKey,
      JSON.stringify({ queue, samplesCache, snapshots, lastSyncAt, manualOffline }),
    )
    const { selectedId, roundA, roundB, draftNotes } = state.development
    localStorage.setItem(uiPersistKey, JSON.stringify({ selectedId, roundA, roundB, draftNotes }))
  })
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
