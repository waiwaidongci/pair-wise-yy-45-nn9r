import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RoundName } from '../api/types'

type DevelopmentState = {
  selectedId: string
  roundA: RoundName
  roundB: RoundName
  draftNotes: Record<string, string>
  activeAnnotation: string | null
}

const storageKey = 'garment-sampling-ui-v2'
const legacyKey = 'garment-sampling-draft-v1'

// 旧版本把整个样衣数据塞进 localStorage，会与服务器快照冲突，直接弃用
localStorage.removeItem(legacyKey)

const saved = (() => {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as Partial<DevelopmentState>) : null
  } catch {
    return null
  }
})()

const initialState: DevelopmentState = {
  selectedId: saved?.selectedId ?? 'SMP-26018',
  roundA: saved?.roundA ?? '第二轮',
  roundB: saved?.roundB ?? '第三轮',
  draftNotes: saved?.draftNotes ?? {},
  activeAnnotation: null,
}

const slice = createSlice({
  name: 'development',
  initialState,
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: RoundName; b?: RoundName }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    saveDraft(state, action: PayloadAction<{ sampleId: string; notes: string }>) {
      state.draftNotes[action.payload.sampleId] = action.payload.notes
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
  },
})

export const { selectSample, setRounds, saveDraft, toggleAnnotation } = slice.actions
export const developmentReducer = slice.reducer
