import { describe, expect, test } from 'claude-code/testing'

import { buildPrompt, commandOf, withExplanation } from '../hooks/lib'

const answer = (text: string) => async () => ({
  value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
}) as never

describe('lib', () => {
  test('commandOf と buildPrompt', async () => {
    expect(commandOf({ command: 'ls -la' })).toBe('ls -la')
    expect(commandOf(null)).toBe('')
    expect(buildPrompt('Bash', 'rm -rf dist', '掃除')).toContain('rm -rf dist')
  })
  test('withExplanation は元の理由を残して説明を足す', async () => {
    expect(withExplanation('Bash(rm:*) に当たる', 'dist を消します')).toBe('Bash(rm:*) に当たる\n\n説明: dist を消します')
    expect(withExplanation(undefined, ' x ')).toBe('説明: x')
  })
})

describe('engine', () => {
  test('人に聞く Bash の確認には日本語の説明が理由に付く', async ($, on) => {
    let prompt = ''
    on('tool.check', async () => ({ decision: 'ask', reason: '確認が要ります' }) as never)
    on('model.complete', async (_$, e) => { prompt = (e as { prompt: string }).prompt; return answer('dist フォルダを消します。注意: 元に戻せません。')() })
    const v = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf dist' } })
    expect(v.decision).toBe('ask')
    // 変異: 説明を付けないと赤
    expect(v.reason).toBe('確認が要ります\n\n説明: dist フォルダを消します。注意: 元に戻せません。')
    expect(prompt).toContain('rm -rf dist')
  })

  test('allow・deny・シェル以外には触らず、AI も呼ばない', async ($, on) => {
    let calls = 0
    on('model.complete', async () => { calls++; return answer('x')() })
    on('tool.check', async (_$, e) => ({ decision: (e as { tool: string }).tool === 'Read' ? 'ask' : 'allow' }) as never)
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).reason).toBe(undefined)
    expect((await $.tool.check({ tool: 'Read', input: { file_path: '/x' } })).reason).toBe(undefined)
    // 変異: decision を見ないと赤（自動で通るコマンドにも毎回 Haiku を呼ぶ）
    expect(calls).toBe(0)
  })

  test('AI が答えなければ元の確認をそのまま返す', async ($, on) => {
    on('tool.check', async () => ({ decision: 'ask', reason: 'r' }) as never)
    on('model.complete', async () => ({ value: { isAnswered: false, reason: 'timeout' } }) as never)
    const v = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
    expect(v.decision).toBe('ask')
    expect(v.reason).toBe('r')
  })
})
