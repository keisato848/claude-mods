import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BriefStatus, CtxSnapshot, ReadEntry } from '../types'
import { buildPrompt, buildTitle, colorAt, estimateTokens, fmt, oneLine, parseBrief, renderHtml, renderText, stackedBarSvg, targetOf, topReads } from './lib'
import type { Excerpt } from './lib'

const PANE = 'lens-tokens'
const reads = atom({ plugin: 'session-lens', key: 'reads' } as const, [])
const ctx = atom({ plugin: 'session-lens', key: 'ctx' } as const, null)
const brief = atom({ plugin: 'session-lens', key: 'brief' } as const, null)
const isBusy = atom({ plugin: 'session-lens', key: 'isBusy' } as const, false)
const isBandHidden = atom({ plugin: 'session-lens', key: 'isBandHidden' } as const, false)

/** 裏方の AI 呼び出しはすべてこのモデル。メインの会話のモデルは使わない */
const DEFAULT_MODEL = 'claude-haiku-5-5'

/** /rename の無い環境で、次のプロンプト送信時に付けるセッション名 */
let pendingTitle: string | undefined

async function snapshot($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary', columns: 40 })
  const b = usage.context.breakdown
  if (b === undefined) return
  const api = b.apiUsage
  const snap: CtxSnapshot = {
    at: await $.clock.now(),
    model: b.model,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    percent: b.percentage,
    categories: b.categories.filter(c => c.kind !== 'deferred').map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memoryFiles: b.memoryFiles.map(f => ({ path: f.path, tokens: f.tokens })),
    mcpTokens: b.mcpTools.filter(t => t.isLoaded).reduce((s, t) => s + t.tokens, 0),
    skillTokens: b.skills?.tokens ?? 0,
    lastCall:
      api === null
        ? null
        : { input: api.input_tokens, output: api.output_tokens, cacheRead: api.cache_read_input_tokens, cacheWrite: api.cache_creation_input_tokens },
  }
  await update($, ctx, () => snap)
}

async function rename($: EngineInterface, title: string): Promise<void> {
  const commands = await $.command.list()
  if (commands.some(c => c.name === 'rename')) {
    await $.command.run({ command: 'rename', args: title })
    pendingTitle = undefined
  } else {
    // /rename の無い環境では次のプロンプト送信時に sessionTitle で付ける
    pendingTitle = title
    $.ui.status(title)
  }
}

/** 作業状況・次の一手・ステータス・タグを Haiku に 1 回で作らせる */
async function refreshBrief($: EngineInterface, model: string, autoRename: boolean, fixedStatus: BriefStatus | null): Promise<void> {
  await update($, isBusy, () => true)
  try {
    const messages = await $.session.messages()
    const first = messages.find(m => m.role === 'user')?.text ?? ''
    const recent: Excerpt[] = messages.slice(-8).map(m => ({
      role: m.role === 'user' ? '利用者' : 'AI',
      text: m.text,
      tools: m.toolUses.map(t => `${t.tool} ${targetOf(t.input)}`.trim()),
    }))
    // 機械で決まるものは機械で: 質問ツールで終わったら確認待ち
    const lastAi = [...messages].reverse().find(m => m.role === 'assistant')
    const asked = lastAi?.toolUses.some(t => t.tool === 'AskUserQuestion') ?? false
    const status = fixedStatus ?? (asked ? '確認待ち' : null)

    const r = await $.model.complete({
      model,
      system: 'あなたは開発セッションの記録係です。指定された JSON だけを日本語で返します。',
      prompt: buildPrompt(first, recent, status),
      maxTokens: 500,
      timeoutMs: 30000,
    })
    if (!r.isAnswered) {
      $.ui.log(`session-lens: ${model} が答えませんでした（${r.reason}）`)
      return
    }
    const spent = (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0)
    const parsed = parseBrief(r.text, await $.clock.now(), spent)
    if (parsed === null) {
      $.ui.log('session-lens: 要約の JSON を読めませんでした')
      return
    }
    await update($, brief, () => parsed)
    if (autoRename) await rename($, buildTitle(parsed))
  } finally {
    await update($, isBusy, () => false)
  }
}

export const register: Register = (on, options) => {
  const model = typeof options.backgroundModel === 'string' && options.backgroundModel !== '' ? options.backgroundModel : DEFAULT_MODEL
  const autoRename = options.autoRename !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lens', description: 'トークン内訳ペインを開く' })
    await $.command.register({ name: 'lens-html', description: 'トークン内訳を HTML に書き出す（.claude/session-lens-report.html）' })
    await $.command.register({ name: 'lens-text', description: 'トークン内訳を文字で会話に出す（ペインの無いスマホのアプリ向け）' })
    await $.command.register({ name: 'lens-brief', description: '作業状況・次の一手・セッション名を今すぐ作り直す（Haiku 5.5）' })
    void $.ui.open({ id: PANE, title: 'トークン内訳' })
    return next(e)
  })

  on('command.run', { command: 'lens' }, async $ => {
    await snapshot($)
    await $.ui.open({ id: PANE, title: 'トークン内訳' })
    return { text: 'トークン内訳ペインを開きました。' }
  })

  on('command.run', { command: 'lens-html' }, async $ => {
    await snapshot($)
    const path = `${await $.session.root()}/.claude/session-lens-report.html`
    await $.fs.write(path, renderHtml(await read($, ctx), await read($, reads), await read($, brief)))
    return { text: `HTML を書き出しました: ${path}` }
  })

  // ペインを置けない画面（スマホのアプリ）向け。text は会話に残り、モデルも読む
  on('command.run', { command: 'lens-text' }, async $ => {
    await snapshot($)
    return { text: renderText(await read($, ctx), await read($, reads), await read($, brief)) }
  })

  on('command.run', { command: 'lens-brief' }, async $ => {
    $.clock.after(0, () => void refreshBrief($, model, autoRename, null))
    return { text: `作業状況を ${model} で作り直しています。` }
  })

  // 何のデータ読み込みにトークンを使ったか: ツール結果の大きさを記録
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined) {
      const entry: ReadEntry = {
        id: e.tool_use_id,
        turn: await $.session.turns(),
        tool: String(e.tool),
        target: targetOf(e as unknown as Record<string, unknown>),
        tokens: estimateTokens(ran.text ?? ''),
      }
      await update($, reads, list => [...list, entry].slice(-500))
    }
    return ran
  })

  // メインのターンが終わったら: 内訳を取り直し、要約とセッション名を Haiku で作る
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const fixed: BriefStatus | null = e.reason === 'error' || e.reason === 'refusal' ? 'エラー' : e.isAborted ? '中断' : null
      $.clock.after(0, () => {
        void snapshot($).then(() => refreshBrief($, model, autoRename, fixed))
      })
    }
    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (pendingTitle === undefined) return result
    const title = pendingTitle
    pendingTitle = undefined
    return { ...result, sessionTitle: title }
  })

  // 右ペイン: トークン内訳
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, ctx)
    const list = await read($, reads)
    const width = Math.max(20, (e.props.bodyColumns ?? 40) - 2)
    const rowsLeft = Math.max(4, (e.viewport?.rows ?? 30) - 18)
    const top = topReads(list, rowsLeft)

    if (e.surface === 'desktop') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {snap === null && <Text dimColor>1 ターン終えると内訳が入ります。</Text>}
          {snap !== null && <Text bold>{fmt(snap.total)} / {fmt(snap.max)} tokens（{snap.percent}%）</Text>}
          {snap !== null && <Svg source={stackedBarSvg(snap, 320)} alt="使用中カテゴリの積み上げ棒" />}
          {snap !== null &&
            snap.categories.map((c, i) => (
              <Text dimColor={c.kind !== 'used'}>
                <Text color={c.kind === 'used' ? colorAt(i) : undefined}>■</Text> {c.name} {fmt(c.tokens)}
              </Text>
            ))}
          {snap?.lastCall && (
            <Text dimColor>直近: 入力 {fmt(snap.lastCall.input)} / cache読 {fmt(snap.lastCall.cacheRead)} / cache書 {fmt(snap.lastCall.cacheWrite)} / 出力 {fmt(snap.lastCall.output)}</Text>
          )}
          {snap !== null && snap.memoryFiles.length > 0 && <Text bold>メモリファイル</Text>}
          {snap?.memoryFiles.map(f => (
            <Text>{fmt(f.tokens).padStart(6)} {oneLine(f.path, 60)}</Text>
          ))}
          <Text bold>読み込み元（ツール結果の概算）</Text>
          {top.length === 0 && <Text dimColor>まだありません</Text>}
          {top.map(r => (
            <Text>{fmt(r.tokens).padStart(6)} ×{r.count} {oneLine(r.label, 60)}</Text>
          ))}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const barWidth = Math.max(8, width - 18)
    return (
      <Box flexDirection="column">
        {snap === null && <Text dimColor>1 ターン終えると内訳が入ります。</Text>}
        {snap !== null && <Text bold>{fmt(snap.total)}/{fmt(snap.max)} ({snap.percent}%)</Text>}
        {snap !== null &&
          snap.categories.map((c, i) => {
            const n = Math.round((c.tokens / Math.max(snap.max, 1)) * barWidth)
            return (
              <Text>
                <Text color={c.kind === 'used' ? colorAt(i) : undefined} dimColor={c.kind !== 'used'}>{'█'.repeat(n).padEnd(barWidth, '·')}</Text> {fmt(c.tokens).padStart(5)} {oneLine(c.name, 14)}
              </Text>
            )
          })}
        {snap?.lastCall && (
          <Text dimColor>直近 in {fmt(snap.lastCall.input)} c読 {fmt(snap.lastCall.cacheRead)} c書 {fmt(snap.lastCall.cacheWrite)} out {fmt(snap.lastCall.output)}</Text>
        )}
        {snap?.memoryFiles.map(f => (
          <Text dimColor>{fmt(f.tokens).padStart(5)} メモリ {oneLine(f.path, width - 14)}</Text>
        ))}
        <Text bold>読み込み元（概算）</Text>
        {top.length === 0 && <Text dimColor>まだありません</Text>}
        {top.map(r => (
          <Text>{fmt(r.tokens).padStart(5)} {oneLine(r.label, width - 7)}</Text>
        ))}
      </Box>
    )
  })

  // 下部: 作業状況と次の一手
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, brief)
    const busy = await read($, isBusy)
    if (e.props.hasSurvey || (await read($, isBandHidden)) || (b === null && !busy)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 12)
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{b ? `[${b.status}][${b.tag}] ` : ''}</Text>
          <Text dimColor>{busy ? `${model} で更新中…` : ''}</Text>
          <Button key="hide" label="隠す" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        {b && <Text>作業: {oneLine(b.summary, width * 2)}</Text>}
        {b && <Text>次の一手: {oneLine(b.next, width)}</Text>}
      </Box>
    )
  })
}
