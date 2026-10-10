# session-lens（Claude Code の Mod）

Claude Code の Mods（関数フックのプラグイン）を使い、画面の表示とセッション名の付与を自動にする。

| 機能 | 置き場所 | 中身 | AI 呼び出し |
|---|---|---|---|
| 1. トークン内訳 | 右ペイン「トークン内訳」 | `/context` と同じカテゴリ別の内訳（棒グラフ）、直近の API 呼び出しの入力・キャッシュ読み/書き・出力、メモリファイル（CLAUDE.md / AGENTS.md）ごとの量、**ツール結果ごとの読み込み量**（どのファイル・コマンド・検索でトークンを使ったか。同じ対象は合算して多い順） | 使わない（エンジンの数値と文字数の概算） |
| 2. 作業状況と次の一手 | プロンプトの上の帯（下部） | `[ステータス][タグ]`、これまでの作業の要約、AI が次に予定している行動 | Haiku 5.5 |
| 3. セッション名 | セッション一覧のタイトル | ターン完了ごとに `[ステータス][タグ] 作業名` へ改名（例: `[確認待ち][Mods] UI自動化設定`） | Haiku 5.5（2 と同じ 1 回の呼び出し） |

ステータスは `確認待ち` / `完了` / `作業中` / `エラー` / `中断` の 5 つ。機械で決まるものは機械で決める。最後に `AskUserQuestion` を使っていれば `確認待ち`、API エラーなら `エラー`、中断なら `中断` とする。それ以外（完了か作業中か）だけを Haiku が判断する。

## モデルの割り当て

- 要約・状況判断・タイトル生成（2 と 3）では、ターン完了ごとに `$.model.complete` を `claude-haiku-5-5` で **1 回だけ** 呼ぶ。メインの会話のモデルは使わない
- 既定値は `hooks/register.tsx` の `DEFAULT_MODEL` と、`plugin.json` の `userConfig.backgroundModel` に置いてある。`backgroundModel` の選択肢は `claude-haiku-5-5` だけに絞ってあるので、`/config` から別のモデルへは変えられない
- 1 のトークン内訳は `$.session.usage({ breakdown: 'summary' })`（ローカルの概算で、token-count API は呼ばない）とツール結果の文字数から出す。AI の費用はかからない
- サブエージェントのターン完了では動かない（メインのターンだけ）

## 入れ方

> [!NOTE]
> Mods（関数フックのプラグイン）は早期アクセス機能で、API はリリースごとに変わりうる。このフォルダは Claude Code 2.1.294 で `claude plugin validate`・型検査・`claude plugin test`（6 件）を通してある。

### 手元に入れる

このリポジトリはマーケットプレイス `keisato-mods` になっている。GitHub から名前で入れる。

```sh
claude plugin marketplace add keisato848/claude-mods
# ユーザースコープで入れる（全プロジェクトで有効）
claude plugin install session-lens@keisato-mods
```

入れた Mod は `~/.claude/plugins/cache/keisato-mods/session-lens/<version>/` のコピーから読み込まれる。オン・オフは `/plugin` で切り替える。

> [!WARNING]
> ユーザースコープで入れると、すべてのセッションで読み込まれる（自己責任）。この Mod はメインのターンが終わるたびに Haiku 5.5 を 1 回呼び、セッション名を書き換える。止めるときは `/plugin` で無効にする。改名だけ止めるときは `/config` で `autoRename` を切る。

新しい版へ上げる:

```sh
claude plugin marketplace update keisato-mods
claude plugin update session-lens@keisato-mods
```

上げたあとは Claude Code を開き直す。

> [!IMPORTANT]
> Mod を直す側は、`mods/session-lens/.claude-plugin/plugin.json` の `version` を必ず上げる。`version` が同じままだと、`claude plugin update` は「already at the latest version」と答えて何もしない。

### クラウドセッションで使う

クラウドセッションは、リポジトリの settings.json で宣言したプラグインを入れない。クラウド環境の設定の Setup script に次の 1 行を置く。どのリポジトリのセッションでも入る（公開リポジトリなので認証が要らない）。

```sh
claude plugin marketplace add keisato848/claude-mods || true; claude plugin install session-lens@keisato-mods || true
```

> [!WARNING]
> Setup script は必ず 0 で終わる形にする。0 以外で終わるとセッションが起動しない。各コマンドの後ろの `|| true` を外さない。

Setup script は環境のキャッシュを作るときだけ走る（初回・スクリプトか許可ホストの変更時・約 7 日で失効）。動いているセッションには入らないので、保存したら新しいセッションを起動する。新しい版はキャッシュが作り直されたときに入る。

<details><summary>パスで読み込む方法（インストールしない）</summary>

そのセッションだけ試す:

```sh
claude --plugin-dir /path/to/claude-mods/mods/session-lens
```

毎回読み込む（`~/.claude/settings.json` の `env`。プロジェクトの settings.json に書いても読み込まれない）:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-mods/mods/session-lens"
  }
}
```

</details>

### 確かめる

```sh
claude plugin validate mods/session-lens
claude plugin test mods/session-lens
```

## 使い方

| コマンド | 動き |
|---|---|
| `/lens` | トークン内訳ペインを開く（ターミナルが 144 列以上あれば起動時に自動で開く） |
| `/lens-html` | 内訳を単体の HTML（`<プロジェクト>/.claude/session-lens-report.html`）に書き出す。ブラウザで開く |
| `/lens-text` | 内訳を文字で会話に出す。スマホのアプリはペインを出せないので、スマホではこちらを使う。出した文字は AI も読むので、打つたびに数百トークン増える |
| `/lens-brief` | 作業状況・次の一手・セッション名を今すぐ作り直す |

下部の帯は「隠す」ボタンで閉じられる。

## 制約

- セッション名は、組み込みの `/rename` を Mod から呼んで変える。そのためトランスクリプトに `/rename` の出力が 1 行残る。`/rename` が無い環境では、次にプロンプトを送ったときに `sessionTitle` で付ける
- ツール結果の読み込み量は文字数からの概算（ASCII は 4 文字で 1、それ以外は 1 文字で 1 と数える）。カテゴリ別の内訳はエンジンの見積もり
- スマホのアプリではペインが出ない（2026-10-10 に実機で確認）。内訳は `/lens-text` で見る
- 右ペインは、ターミナルではブロック文字の棒、デスクトップアプリでは SVG の積み上げ棒で描く。ペインの中には任意の HTML を描けないので、HTML は `/lens-html` で書き出す
