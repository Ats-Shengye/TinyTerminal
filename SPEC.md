# TinyTerminal 仕様書

## 概要

スマホ（Termux）からTailscale経由でPCのシェルを操作するブラウザベースのリモートターミナル。
TermuxのIME制約を回避し、ブラウザのtextareaで日本語入力を完全サポートする。

### TinyCC-WebUIからの方針転換

前身のTinyCC-WebUIはClaude Code特化でCLI出力をパースし自前UIに変換していたが、以下の問題が発生した：

- ディレクトリパスを手入力（コピペ）する必要がある
- resumeコマンドを使っても過去の発言を遡れない
- CLI本来のインタラクション（Tab補完、履歴等）が使えない

本プロジェクトではCLI出力のパースを廃止し、PTY出力をxterm.jsにそのままパススルーする。
Claude Codeに限らず任意のCLIツールを操作可能。

---

## アーキテクチャ

```
[Termux ブラウザ]
       ↕ WebSocket（Tailscale VPN経由）
[PC: Node.js サーバー]
       ↕ node-pty
[シェル (bash/zsh)]
       → claude, git, cd 等任意のコマンド実行
```

### 構成要素

| レイヤー | 技術 | 役割 |
|---|---|---|
| フロントエンド | HTML + CSS + JS + xterm.js | ターミナル表示 + 日本語入力UI |
| 通信 | WebSocket | ブラウザ ↔ サーバー間の双方向通信 |
| バックエンド | Node.js + node-pty | PTY管理、シェルプロセス制御 |
| ネットワーク | Tailscale | 暗号化トンネル（WireGuardベース） |

### 通信フロー

1. ブラウザ → WebSocket → サーバー：ユーザー入力テキスト
2. サーバー → node-pty：PTYのstdinに書き込み（`ptyProcess.write(data)`）
3. node-pty → サーバー：PTYのstdout出力（ANSIエスケープシーケンス含む）
4. サーバー → WebSocket → ブラウザ：xterm.jsにそのまま流す（パースしない）

※ PTYはWebSocket接続直後ではなく、クライアントからの最初のresizeメッセージ受信時に遅延起動する（正確な端末サイズでの初期化のため）。

---

## UI設計

### レイアウト構成

#### 通常モード

```
┌─────────────────────────────┐
│ [●] user@host     TinyTerminal│  ← ステータスバー
├─────────────────────────────┤
│                              │
│   xterm.js ターミナル表示      │  ← flex-grow: 1
│   ANSIカラー・カーソルそのまま  │     スワイプ/ホイールでスクロール
│                              │
│                              │
├─────────────────────────────┤
│ [Esc] [Tab] [Ctrl] [Alt] [Shift]│  ← 特殊キーバー Row 1
│ [ / ] [ - ] [ ← ] [↑] [↓] [→] │  ← 特殊キーバー Row 2
├─────────────────────────────┤
│ [textarea 1-4行] [↔] [▶]    │  ← position固定、下部に常駐
└─────────────────────────────┘
```

#### 拡大モード（↔ボタンで切り替え）

```
┌─────────────────────────────┐
│ expanded input     123 chars │
├─────────────────────────────┤
│                              │
│   textarea（全画面）          │  ← 行数制限なし、内部スクロール
│                              │
│                              │
│                              │
│             [↔ 戻る] [送信]  │
└─────────────────────────────┘
```

### モード遷移

| 現在の状態 | アクション | 遷移先 | テキスト |
|---|---|---|---|
| 通常モード | ↔ボタン押下 | 拡大モード | 保持 |
| 拡大モード | ↔戻るボタン押下 | 通常モード | 保持 |
| 拡大モード | 送信 | 通常モード | クリア |
| 通常モード | 送信 | 通常モード | クリア |

### textareaの挙動

- 初期状態：1行
- 入力に応じて自動伸縮、最大4行まで
- 4行以降は内部スクロール
- Enter：送信（`text + '\r'`をPTYに送信）
- Shift+Enter：改行（textarea内で改行を挿入）
- 送信ボタン：送信
- 空テキストでEnter/送信：`\r`のみ送信（TUIアプリでのEnterキー動作）

---

## 入力設計

### 入力経路

入力は2つの経路でPTYに到達する：

| 入力経路 | 受け付ける入力 | 用途 |
|---|---|---|
| textarea | テキスト全般（日本語含む） | コマンド入力、プロンプト入力（IME対応） |
| xterm.js直接入力 | 全キー入力 | ターミナルタップ→ソフトキーボードでの直接操作 |
| 特殊キーバー | 制御キー・修飾キー | ソフトキーボードで押せないキーの補完 |

### xterm.jsの入力制御

**直接パススルー方式**：`terminal.onData()`でxterm.jsのキーボード入力を全てPTYに直接転送する。`attachCustomKeyEventHandler`は使用しない。

```js
terminal.onData((data) => {
  sendInput(data);
});
```

スマホではターミナル領域をタップするとソフトキーボードが表示され、xterm.jsが入力を受け取る。PCではxterm.jsのデフォルト動作でキーボード入力がそのまま処理される。

textareaは日本語入力（IME）が必要な場合の補助入力手段として機能する。

### 特殊キーバー（Termuxライク extra-keys）

ソフトキーボードでは押せない制御キーをタップで送信するための2行ボタン配列。textarea入力欄の直上に常駐。

**配置：**

| Row 1 | Esc | Tab | Ctrl | Alt | Shift |
|---|---|---|---|---|---|
| Row 2 | / | - | ← | ↑ | ↓ | → |

**修飾キーの挙動（Ctrl / Alt / Shift）：**
- タップでトグルON → 次のtextareaキー入力と組み合わせてPTYに送信 → 自動でOFFに戻る
- 例：[Ctrl]タップ → textarea上でCキー → `\x03`（Ctrl+C）をPTYに送信
- ON状態はボタンのハイライト（背景色変更）で視覚的に示す

**通常キーの挙動（Esc / Tab / / / - / 矢印キー）：**
- タップで即座にPTYに送信（textareaを経由しない）
- Esc: `\x1b`、Tab: `\t`、矢印: ANSIエスケープシーケンス
- `/` と `-`: 文字としてPTYに直接送信（ソフトキーボードの記号面切り替え回避用）

---

## xterm.js設定

| 設定項目 | 値 | 備考 |
|---|---|---|
| scrollback | 5000 | バッファ行数（必要に応じて調整） |
| cursorBlink | true | カーソル点滅 |
| fontSize | 13 | モバイル視認性とのバランス |
| fontFamily | 'JetBrains Mono', 'Fira Code', monospace | 等幅フォント |
| theme | ダークテーマ | 背景 #0c0c14 系 |

### タッチスクロール

document直接のtouchイベントハンドラ（capture phase, `passive: false`）で実装。xterm.jsのViewport内蔵スクロールではなく、独自のタッチ処理を使用。

**通常バッファ（シェル）：**
- スワイプ上下で`terminal.scrollLines()`によるスクロールバック操作

**代替スクリーンバッファ（nvim等TUIアプリ）：**
- `terminal.buffer.active.type === 'alternate'`で検出
- スワイプを矢印キー（`\x1b[A` / `\x1b[B`）に変換してPTYに送信
- ナチュラルスクロール方向（スワイプ上→カーソル上）

### ソフトキーボード対応

`window.visualViewport` APIで画面高さを動的調整し、キーボード表示時にtextareaが隠れることを防ぐ。

```js
window.visualViewport.addEventListener('resize', () => {
  document.body.style.height = `${window.visualViewport.height}px`;
  handleResize();
});
```

---

## サーバー設計

### PTY管理（遅延起動方式）

PTYはWebSocket接続時ではなく、クライアントからの最初の`resize`メッセージ受信時に起動する。これにより：
- クライアントの実際の端末サイズでPTYが初期化される（80x24固定ではない）
- 認証が必要な場合、認証完了前にシェル出力が漏洩しない

```js
import pty from 'node-pty';

function createPTY(cols = 80, rows = 24, shell = null) {
  const selectedShell = shell || process.env.SHELL || '/bin/bash';

  // 環境変数ホワイトリスト（SAFE_ENV_KEYS）から安全な値のみ渡す
  // EDITOR/VISUALは予期しないプログラム起動のリスクがあるため除外
  const safeEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key];
    }
  }
  safeEnv.TERM = 'xterm-256color';

  return pty.spawn(selectedShell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: safeEnv,
  });
}
```

### WebSocket処理

- クライアント → サーバー：`{ type: 'input', data: string }` → `ptyProcess.write(data)`
- サーバー → クライアント：`{ type: 'output', data: string }` → `terminal.write(data)`
- クライアント → サーバー：`{ type: 'resize', cols: number, rows: number }` → `ptyProcess.resize(cols, rows)`

### リサイズ対応

ブラウザのウィンドウサイズ変更・回転時にxterm.jsのfitAddonでサイズ計算し、WebSocket経由でPTYをリサイズする。

---

## セキュリティ

TinyCC-WebUIから引き継ぐ対策に加え、Tailscale前提の設計。

### 引き継ぎ項目

| 対策 | 内容 |
|---|---|
| Origin検証 | WebSocket接続時にhostname厳密一致（substring bypass防止） |
| CSP | Content-Security-Policyヘッダー設定（`style-src`にCDNドメインを含む） |
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| 入力バリデーション | 長さ制限（10000文字） |

### 追加考慮事項

- Tailscale内部ネットワークのみでの利用を前提とする
- バインドアドレスはデフォルト`127.0.0.1`（外部公開を防ぐ）
  - Tailscale経由でアクセスする場合は`BIND_ADDRESS=0.0.0.0`に設定
- トークン認証（オプション）
  - `TINYTERMINAL_TOKEN`環境変数を設定すると、WebSocket接続時にトークン認証を要求
  - トークンはWebSocket接続後の最初のメッセージ `{ type: 'auth', token: '...' }` で送信
  - URLパラメータではなくWebSocketメッセージで送ることで、ブラウザ履歴・Refererヘッダー・サーバーログへの漏洩を防ぐ
  - トークン比較は`crypto.timingSafeEqual`を使用し、タイミング攻撃を防ぐ
- 環境変数ホワイトリスト
  - PTYに渡す環境変数は`SAFE_ENV_KEYS`でホワイトリスト化
  - `EDITOR`/`VISUAL`は予期しないプログラム起動のリスクがあるため除外
- PTY遅延起動
  - 認証完了前はPTYを起動しない（シェル出力の漏洩防止）
  - クライアントのresizeメッセージを受信してから初めてPTYを生成
- ログインジェクション防止
  - `sanitizeLogMessage()`で制御文字・改行をエスケープ
- 接続数制限
  - `MAX_CONNECTIONS`（デフォルト3）で同時接続数を制限

---

## Nice to have

### 画像ペースト（優先度：低）

- Clipboard APIで`paste`イベントを監視
- 画像データをBase64化してWebSocket経由でサーバーに送信
- サーバー側で一時ファイルに保存し、ファイルパスをPTYに入力として差し込む
- Claude Codeの`--image`オプション対応状況に依存するため、実装は調査後に判断

---

## 技術スタック

| 用途 | ライブラリ |
|---|---|
| ターミナルUI | xterm.js |
| ターミナルサイズ自動調整 | @xterm/addon-fit |
| WebSocket（サーバー） | ws |
| PTY | node-pty |
| HTTPサーバー | Node.js http標準モジュール |

### ディレクトリ構成

```
tinyterminal/
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js
├── src/
│   ├── server.js
│   └── constants.js
├── tests/
│   ├── server.test.js
│   ├── client.test.js
│   └── constants.test.js
├── .gitignore
├── package.json
├── vitest.config.js
├── SPEC.md
├── GLOSSARY.md
└── README.md
```

---

## 環境変数

| 変数 | 説明 | デフォルト |
|---|---|---|
| PORT | サーバーポート | 3000 |
| SHELL | 起動するシェル | $SHELL or /bin/bash |
| TINYTERMINAL_TOKEN | 認証トークン（設定時はWebSocket接続時に必須） | なし（認証なし） |
| BIND_ADDRESS | バインドアドレス | 127.0.0.1 |

---

## 起動方法

```bash
npm install
npm start
```

Termuxブラウザから `http://[TailscaleIP]:3000` にアクセス。
