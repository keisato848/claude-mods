import { describe, expect, mock, test } from 'claude-code/testing'

import { buildTitle, estimateTokens, parseBrief, renderText, targetOf } from '../hooks/lib'

const REPLY = JSON.stringify({
  status: '完了',
  tag: 'Mods設定です長い',
  summary: 'Mods の設定を作った。',
  next: '利用者の指示待ち',
  title: 'UIの自動化設定',
})

describe('lib', () => {
  test('parseBrief はタグを 6 文字に詰め、不明なステータスを作業中に倒す', async () => {
    const b = parseBrief(`前置き ${REPLY}`, 1, 10)
    expect(b?.tag).toBe('Mods設…')
    expect(b?.status).toBe('完了')
    expect(parseBrief('{"status":"謎"}', 1, 0)?.status).toBe('作業中')
    expect(parseBrief('JSON なし', 1, 0)).toBe(null)
  })

  test('buildTitle は [ステータス][タグ] 作業名', async () => {
    expect(buildTitle({ status: '確認待ち', tag: 'Mods', title: '設定作成' })).toBe('[確認待ち][Mods] 設定作成')
  })

  test('renderText は計測前でも読める文字を返し、読み込み元を多い順に出す', async () => {
    expect(renderText(null, [], null)).toContain('まだ計測していません')
    const ctx = {
      at: 1, model: 'm', total: 15000, max: 200000, percent: 8,
      categories: [{ name: 'Messages', tokens: 9000, kind: 'used' }, { name: 'Free space', tokens: 185000, kind: 'free' }],
      memoryFiles: [], mcpTokens: 0, skillTokens: 0, lastCall: null,
    }
    const reads = [
      { id: 'a', turn: 1, tool: 'Read', target: '/s.ts', tokens: 100 },
      { id: 'b', turn: 1, tool: 'Read', target: '/b.ts', tokens: 3000 },
    ]
    const text = renderText(ctx, reads, null)
    expect(text).toContain('15k / 200k tokens（8%）')
    expect(text).toContain('- Messages: 9.0k')
    expect(text).not.toContain('Free space')
    expect(text.indexOf('/b.ts')).toBeLessThan(text.indexOf('/s.ts'))
  })

  test('targetOf と estimateTokens', async () => {
    expect(targetOf({ file_path: '/a/b.ts', limit: 3 })).toBe('/a/b.ts')
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('日本語')).toBe(3)
  })
})

describe('engine', () => {
  test('クラウドではセッション管理の MCP でアプリ上の名前も変える', async ($, on) => {
    const clock = mock.clock(on)
    const titles: { session_id: string; title: string }[] = []

    on('session.messages', async () => ({ value: [{ role: 'user', text: 'Mods を作って', toolUses: [] }] }) as never)
    on('model.complete', async () => ({
      value: {
        isAnswered: true,
        text: REPLY,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }) as never)
    on('command.list', async () => ({ value: [] }) as never)
    on('tool.check', async () => ({ decision: 'allow' }) as never)
    on('tool.call', async (_$, e) => {
      const input = e as unknown as { tool: string; session_id: string; title: string }
      if (input.tool === 'mcp__claude-code-remote__get_session') return { result: '', text: '{"ccr":{"id":"session_01abc","title":"x"}}' } as never
      if (input.tool === 'mcp__claude-code-remote__set_session_title') {
        titles.push({ session_id: input.session_id, title: input.title })
        return { result: '', text: 'ok' } as never
      }
      return { deny: 'unexpected' } as never
    })

    await $.command.run({ command: 'lens-brief', args: '' } as never)
    await clock.advance(10)

    expect(titles).toEqual([{ session_id: 'session_01abc', title: '[完了][Mods設…] UIの自動化設定' }])
  })

  test('/lens-brief は Haiku 5.5 で要約し、/rename で改名し、下部に次の一手を出す', async ($, on) => {
    const clock = mock.clock(on)
    const models: string[] = []
    let renamed = ''

    on('session.messages', async () => ({
      value: [
        { role: 'user', text: 'Mods を作って', toolUses: [] },
        { role: 'assistant', text: '作りました', toolUses: [] },
      ],
    }) as never)
    on('model.complete', async (_$, e) => {
      models.push(e.model)
      return {
        value: {
          isAnswered: true,
          text: REPLY,
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      } as never
    })
    on('command.list', async () => ({ value: [{ name: 'rename', description: 'rename', source: 'builtin' }] }) as never)
    on('command.run', { command: 'rename' }, async (_$, e) => {
      renamed = e.args
      return { text: '' }
    })

    await $.command.run({ command: 'lens-brief', args: '' } as never)
    await clock.advance(10)

    expect(models).toEqual(['claude-haiku-5-5'])
    expect(renamed).toBe('[完了][Mods設…] UIの自動化設定')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'session-lens', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
      expect((await ui.findAll({ type: 'Text', text: /次の一手: 利用者の指示待ち/ })).length > 0).toBe(true)
    }
  })

  test('右ペインは /context の内訳と読み込み元を両方の面に描く', async ($, on) => {
    mock.clock(on)
    on('session.usage', async () => ({
      value: {
        startedAt: 0,
        context: {
          window: 200000,
          breakdown: {
            categories: [
              { name: 'System prompt', tokens: 3000, color: 'x', isDeferred: false, kind: 'used' },
              { name: 'Messages', tokens: 12000, color: 'x', isDeferred: false, kind: 'used' },
              { name: 'Free space', tokens: 150000, color: 'x', isDeferred: false, kind: 'free' },
            ],
            totalTokens: 15000, maxTokens: 200000, rawMaxTokens: 200000, autocompactSource: 'model', percentage: 8,
            gridRows: [], model: 'opus', memoryFiles: [{ path: 'AGENTS.md', type: 'Project', tokens: 2500 }],
            mcpTools: [], agents: [], isAutoCompactEnabled: true,
            apiUsage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 14000, cache_creation_input_tokens: 900 },
          },
        },
        rateLimits: {},
        cost: { usd: 0 },
      },
    }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

    await $.command.run({ command: 'lens', args: '' } as never)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'session-lens', surface, component: 'Pane', requestId: 'lens-tokens',
        props: { bodyColumns: 50 } as never, viewport: { columns: 50, rows: 40 } as never,
      })
      expect((await ui.findAll({ type: 'Text', text: /Messages/ })).length > 0).toBe(true)
      expect((await ui.findAll({ type: 'Text', text: /15k/ })).length > 0).toBe(true)
      expect((await ui.findAll({ type: 'Text', text: /AGENTS.md/ })).length > 0).toBe(true)
    }
  })
})
