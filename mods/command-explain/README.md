# command-explain（Claude Code の Mod）

ツールの権限確認が人に回るとき、その操作が何をするかを日本語 2〜3 文で確認画面の理由欄に添える。シェルコマンド（Bash・PowerShell）はコマンドを、ほかのツール（MCP など）は引数を読んで説明する。消す・上書きする・外部へ送るなど元に戻しにくい動作には「注意:」を付ける。

Claude Code にあった Ctrl+E のコマンド説明（`permissionExplainerEnabled`）は v2.1.257 で削除された。その代わり。

## 動き

- `tool.check` で、エンジンの判定が `ask`（人に聞く）のときだけ Haiku 5.5 を 1 回呼び、`reason` に「説明: …」を足す
- 判定が `allow` / `deny` のとき、質問そのものが目的のツール（`AskUserQuestion` など）には触らない。AI も呼ばない
- クラウドセッションの確認はホスト（アプリへ中継する側）が答えるので、ホスト経由の確認にも足す。クラウドでは Bash が最初から許可されていることが多く、シェルの確認はほぼ出ない
- 権限モードが `auto` / `bypassPermissions` / `dontAsk` / `plan` のときは触らない

> [!WARNING]
> Mod が理由を書き換えた確認は「Mod が出した確認」になり、auto モードの分類器が自動で通せなくなる。そのため人に聞かないモードでは何もしない。

- Haiku が 15 秒以内に答えないときや失敗したときは、元の確認をそのまま出す
- モデルは `userConfig.model`（選択肢は `claude-haiku-5-5` だけ）

## 入れ方

```sh
claude plugin marketplace add keisato848/claude-mods
claude plugin install command-explain@keisato-mods
```

クラウドセッションでは、環境の Setup script に次を置く（0 で終わる形にする）。

```sh
claude plugin marketplace add keisato848/claude-mods || true; claude plugin install command-explain@keisato-mods || true
```

## 確かめたこと

- `claude plugin test`（5 件）・`claude plugin validate` を Claude Code 2.1.317 で通過
- 未確認: 実際の承認カード（ターミナル・スマホのアプリ）に説明が出るか。auto モードで何もしないか
