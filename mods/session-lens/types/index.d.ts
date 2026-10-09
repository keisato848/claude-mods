/** ツール呼び出し 1 回で文脈に入ったデータ（何を読んで何トークン使ったか） */
export type ReadEntry = {
  id: string
  turn: number
  tool: string
  target: string
  tokens: number
}

/** /context と同じ内訳の写し（ターン完了ごとに取り直す） */
export type CtxSnapshot = {
  at: number
  model: string
  total: number
  max: number
  percent: number
  categories: { name: string; tokens: number; kind: string }[]
  memoryFiles: { path: string; tokens: number }[]
  mcpTokens: number
  skillTokens: number
  lastCall: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  } | null
}

export type BriefStatus = '確認待ち' | '完了' | '作業中' | 'エラー' | '中断'

/** Haiku が作る作業状況・次の一手・タイトル */
export type Brief = {
  at: number
  status: BriefStatus
  tag: string
  summary: string
  next: string
  title: string
  haikuTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-lens': {
      reads: ReadEntry[]
      ctx: CtxSnapshot | null
      brief: Brief | null
      isBusy: boolean
      isBandHidden: boolean
    }
  }
}
