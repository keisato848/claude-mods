import type { Register } from 'claude-code'

import { buildPrompt, buildToolPrompt, commandOf, inputText, SHELL_TOOLS, SILENT_MODES, SKIP_TOOLS, withExplanation } from './lib'

const DEFAULT_MODEL = 'claude-haiku-5-5'

/** 呼び出しごとの権限モード。classic.PreToolUse が運ぶ値を tool_use_id で引く */
const modeOf = new Map<string, string>()

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model !== '' ? options.model : DEFAULT_MODEL

  on('classic.PreToolUse', async ($, e, next) => {
    const id = (e as { tool_use_id?: string }).tool_use_id
    if (id !== undefined && e.permission_mode !== undefined) {
      modeOf.set(id, e.permission_mode)
      if (modeOf.size > 200) modeOf.delete(modeOf.keys().next().value as string)
    }
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || SKIP_TOOLS.has(e.tool)) return verdict
    const mode = e.tool_use_id === undefined ? undefined : modeOf.get(e.tool_use_id)
    if (mode !== undefined && SILENT_MODES.has(mode)) return verdict
    let prompt: string
    if (SHELL_TOOLS.has(e.tool)) {
      const command = commandOf(e.input)
      if (command === '') return verdict
      prompt = buildPrompt(e.tool, command, String((e.input as { description?: unknown }).description ?? ''))
    } else {
      prompt = buildToolPrompt(e.tool, inputText(e.input))
    }
    const r = await $.model.complete({
      model,
      system: 'あなたは AI の操作を日本語で短く説明する係です。',
      prompt,
      maxTokens: 300,
      timeoutMs: 15000,
    })
    if (!r.isAnswered || r.text.trim() === '') return verdict
    return { ...verdict, reason: withExplanation(verdict.reason, r.text) }
  }).catch(($, e, next) => next(e))
}
