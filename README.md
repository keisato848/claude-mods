# claude-mods

Claude Code の Mods（関数フックのプラグイン）を置くマーケットプレイス `keisato-mods`。

| Mod | 中身 |
|---|---|
| [session-lens](mods/session-lens/README.md) | 右ペインにトークン内訳、プロンプトの上に作業要約と次の一手、ターン完了時にステータス付きのセッション名（裏方の AI 呼び出しは Haiku 5.5） |

## 入れ方

```sh
claude plugin marketplace add keisato848/claude-mods
claude plugin install session-lens@keisato-mods
```

クラウドセッションでの入れ方と更新の手順は、各 Mod の README に書いてある。

> [!NOTE]
> Mods は Claude Code の早期アクセス機能で、API はリリースごとに変わりうる。

## ライセンス

MIT
