import { configureStore } from '@reduxjs/toolkit'
import { samplingApi } from './api'
import { developmentReducer } from '../features/developmentSlice'
import { offlineReducer } from '../features/offlineSlice'

const persistedKey = 'garment-sampling-draft-v1'
const offlineKey = 'garment-sampling-offline-v1'

export const store = configureStore({
  reducer: {
    development: developmentReducer,
    offline: offlineReducer,
    [samplingApi.reducerPath]: samplingApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(samplingApi.middleware),
})

store.subscribe(() => {
  const state = store.getState()
  localStorage.setItem(persistedKey, JSON.stringify(state.development))
  localStorage.setItem(offlineKey, JSON.stringify(state.offline))
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
