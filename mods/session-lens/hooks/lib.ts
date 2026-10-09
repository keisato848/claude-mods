import type { Brief, BriefStatus, CtxSnapshot, ReadEntry } from '../types'

export const STATUSES: readonly BriefStatus[] = ['確認待ち', '完了', '作業中', 'エラー', '中断']

/** 文字数からの概算。ASCII は 4 文字で 1、それ以外（日本語など）は 1 文字で 1 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4) + other
}

const TARGET_KEYS = ['file_path', 'notebook_path', 'path', 'url', 'pattern', 'query', 'command', 'skill', 'description', 'prompt']

/** ツール入力から「何を読んだか」を 1 行で */
export function targetOf(input: Record<string, unknown>): string {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return oneLine(value, 80)
    }
  }
  return ''
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Haiku の返答（JSON のはず）を Brief に。壊れていれば null */
export function parseBrief(text: string, at: number, haikuTokens: number): Brief | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (match === null) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const str = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '')
  const status = STATUSES.find(s => s === str('status')) ?? '作業中'
  const tag = oneLine(str('tag'), 6) || 'misc'
  const title = oneLine(str('title'), 20) || oneLine(str('summary'), 20)
  return { at, status, tag, summary: str('summary'), next: str('next'), title, haikuTokens }
}

/** セッション名: [ステータス][タグ] 作業名 */
export function buildTitle(brief: Pick<Brief, 'status' | 'tag' | 'title'>): string {
  return oneLine(`[${brief.status}][${brief.tag}] ${brief.title}`, 48)
}

export type Excerpt = { role: string; text: string; tools: string[] }

export function buildPrompt(first: string, recent: readonly Excerpt[], fixedStatus: BriefStatus | null): string {
  const log = recent
    .map(m => {
      const tools = m.tools.length > 0 ? `\n  [ツール] ${m.tools.join(' / ')}` : ''
      return `## ${m.role}\n${oneLine(m.text, 800)}${tools}`
    })
    .join('\n\n')
  const statusRule =
    fixedStatus !== null
      ? `status は必ず "${fixedStatus}"。`
      : 'status は次から 1 つ: 確認待ち（利用者への質問・承認・選択待ちで終わった）/ 完了（依頼をやり終えた）/ 作業中（続きが残っている）。'
  return [
    'Claude Code の開発セッションの記録係として、次の JSON だけを返してください（前置き・コードフェンス不要）。',
    '{"status":"…","tag":"…","summary":"…","next":"…","title":"…"}',
    statusRule,
    'tag: プロジェクトかテーマを表す 5 文字程度の短い語（例: Mods, 認証API, CI修正）。',
    'summary: これまでに何をしていたかを 2〜3 文で。',
    'next: AI が次に予定している行動を 1〜2 文で。予定が無ければ「利用者の指示待ち」。',
    'title: 作業内容を表す 15 文字以内の名前。',
    '',
    `# セッション最初の依頼\n${oneLine(first, 400)}`,
    '',
    `# 直近のやり取り\n${log}`,
  ].join('\n')
}

export function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

/** 読み込み元ごとの合計（同じファイルを何度も読めば合算） */
export function topReads(reads: readonly ReadEntry[], limit: number): { label: string; tokens: number; count: number }[] {
  const sums = new Map<string, { label: string; tokens: number; count: number }>()
  for (const r of reads) {
    const label = r.target === '' ? r.tool : `${r.tool}: ${r.target}`
    const cur = sums.get(label) ?? { label, tokens: 0, count: 0 }
    cur.tokens += r.tokens
    cur.count += 1
    sums.set(label, cur)
  }
  return [...sums.values()].sort((a, b) => b.tokens - a.tokens).slice(0, limit)
}

const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']

export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length] ?? '#888888'
}

/** 使用中カテゴリの積み上げ棒（desktop の Svg 用） */
export function stackedBarSvg(ctx: CtxSnapshot, width: number): string {
  const used = ctx.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const max = Math.max(ctx.max, 1)
  let x = 0
  const rects = used
    .map((c, i) => {
      const w = Math.max(1, (c.tokens / max) * width)
      const rect = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="18" fill="${colorAt(i)}"><title>${esc(c.name)} ${c.tokens}</title></rect>`
      x += w
      return rect
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18"><rect x="0" y="0" width="${width}" height="18" fill="#8884"/>${rects}</svg>`
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

/** /lens-html が書き出す単体の HTML レポート */
export function renderHtml(ctx: CtxSnapshot | null, reads: readonly ReadEntry[], brief: Brief | null): string {
  const cats = ctx?.categories.filter(c => c.tokens > 0) ?? []
  const rows = cats
    .map((c, i) => {
      const pct = ctx === null ? 0 : (c.tokens / Math.max(ctx.max, 1)) * 100
      return `<tr><td><span class="sw" style="background:${c.kind === 'used' ? colorAt(i) : '#8886'}"></span>${esc(c.name)}</td><td class="n">${c.tokens.toLocaleString()}</td><td><div class="bar"><div style="width:${pct.toFixed(2)}%;background:${c.kind === 'used' ? colorAt(i) : '#8886'}"></div></div></td></tr>`
    })
    .join('')
  const readRows = topReads(reads, 30)
    .map(r => `<tr><td>${esc(r.label)}</td><td class="n">${r.count}</td><td class="n">${r.tokens.toLocaleString()}</td></tr>`)
    .join('')
  const mem = (ctx?.memoryFiles ?? []).map(f => `<tr><td>${esc(f.path)}</td><td class="n">${f.tokens.toLocaleString()}</td></tr>`).join('')
  const last = ctx?.lastCall
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>トークン内訳</title>
<style>:root{--bg:#fff;--fg:#1d1d1f;--mut:#6e6e73;--line:#e5e5ea}@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--mut:#a1a1a6;--line:#3a3a3c}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:960px}h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{background:var(--line);height:10px;border-radius:5px;overflow:hidden;min-width:80px}.bar div{height:100%}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}.mut{color:var(--mut)}</style></head><body>
<h1>コンテキストのトークン内訳</h1>
<p class="mut">${ctx === null ? 'まだ計測していません（1 ターン終えると入ります）' : `${esc(ctx.model)} · ${ctx.total.toLocaleString()} / ${ctx.max.toLocaleString()} tokens（${ctx.percent}%）· ${new Date(ctx.at).toLocaleString('ja-JP')}`}</p>
${last ? `<p>直近の API 呼び出し: 入力 ${last.input.toLocaleString()} / キャッシュ読み ${last.cacheRead.toLocaleString()} / キャッシュ書き ${last.cacheWrite.toLocaleString()} / 出力 ${last.output.toLocaleString()}</p>` : ''}
<table><tbody>${rows}</tbody></table>
<h2>何の読み込みにトークンを使ったか（ツール結果の概算・上位 30）</h2>
<table><thead><tr><th>読み込み元</th><th class="n">回数</th><th class="n">tokens</th></tr></thead><tbody>${readRows || '<tr><td colspan="3" class="mut">まだありません</td></tr>'}</tbody></table>
<h2>メモリファイル（CLAUDE.md / AGENTS.md など）</h2>
<table><tbody>${mem || '<tr><td class="mut">なし</td></tr>'}</tbody></table>
${brief ? `<h2>作業状況</h2><p><b>[${esc(brief.status)}][${esc(brief.tag)}]</b> ${esc(brief.summary)}</p><p><b>次の一手:</b> ${esc(brief.next)}</p>` : ''}
</body></html>`
}
