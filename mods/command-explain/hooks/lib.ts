/** 人に聞かないモード。ここで説明を足すと人への確認に変わってしまうので触らない */
export const SILENT_MODES = new Set(['auto', 'bypassPermissions', 'dontAsk', 'plan'])

export const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export function commandOf(input: unknown): string {
  const c = (input as { command?: unknown } | null)?.command
  return typeof c === 'string' ? c : ''
}

export function buildPrompt(tool: string, command: string, description: string): string {
  return [
    `次の ${tool} コマンドを実行してよいか、利用者が承認を求められています。`,
    'このコマンドが何をするかを、プログラミングに詳しくない人にも分かる日本語で 2〜3 文で説明してください。',
    '消す・上書きする・外部へ送る・権限を変えるなど、元に戻しにくい動作があれば最後に「注意:」で一言添えてください。無ければ書かないでください。',
    '前置きや見出しは付けず、説明の本文だけを返してください。',
    '',
    `AI が付けた説明: ${description || '（なし）'}`,
    'コマンド:',
    command.slice(0, 4000),
  ].join('\n')
}

export function withExplanation(reason: string | undefined, text: string): string {
  const body = text.trim().slice(0, 600)
  return reason ? `${reason}\n\n説明: ${body}` : `説明: ${body}`
}
