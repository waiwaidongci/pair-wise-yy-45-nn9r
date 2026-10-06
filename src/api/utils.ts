/** 客户端与 MSW 服务端共用的纯工具函数 */

/** 稳定序列化后计算 FNV-1a 风格短哈希，用于快照校验和（演示用途） */
export function checksum(value: unknown): string {
  const json = stableStringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/** 生成离线操作幂等键（同一动作重放多次，服务器只认一份） */
export function makeClientId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function localId(prefix: string): string {
  return `local-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function nowLabel(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function timeLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}
