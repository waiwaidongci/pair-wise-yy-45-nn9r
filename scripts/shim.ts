/** Node 测试环境 DOM shim：必须在任何 store 模块之前导入 */
const memory = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => Array.from(memory.keys())[index] ?? null,
  get length() {
    return memory.size
  },
} as Storage
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
;(globalThis as unknown as { __API_BASE__?: string }).__API_BASE__ = 'http://msw.local'
