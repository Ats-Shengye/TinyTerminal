# Glossary

本プロジェクトの全モジュール・関数・定数・通信仕様・セキュリティ対策の一覧。
コードリーディングの補助資料として使用。

updated: 2026-02-08

## サーバー関数（src/server.js）

| 名前                  | 役割                                                           |
| --------------------- | -------------------------------------------------------------- |
| `startServer`         | HTTP サーバーと WebSocket サーバーの起動                       |
| `createHttpServer`    | 静的ファイル配信 + セキュリティヘッダー付与                    |
| `handleConnection`    | WebSocket 接続のハンドリング、認証・PTY管理・メッセージルーティング |
| `createPTY`           | PTYプロセスの生成（環境変数ホワイトリスト適用）                |
| `validateInput`       | サーバー側の入力バリデーション（空文字列拒否、長さ制限、null byte検査） |
| `validatePort`        | PORT環境変数のバリデーション（1024-65535）                     |
| `validateBindAddress` | BIND_ADDRESS環境変数のバリデーション（許可リスト照合）         |
| `isAllowedOrigin`     | Origin検証（hostname厳密一致、Tailscale CGNAT範囲許可）        |
| `isTailscaleIP`       | IPアドレスがTailscale CGNAT範囲（100.64.0.0/10）か判定        |
| `sanitizeLogMessage`  | ログメッセージから制御文字・改行をエスケープ                   |
| `secureTokenCompare`  | `crypto.timingSafeEqual`によるタイミング攻撃耐性のトークン比較 |
| `log`                 | タイムスタンプ + サニタイズ付きログ出力                        |

## クライアント関数（public/client.js）

| 名前                  | 役割                                                           |
| --------------------- | -------------------------------------------------------------- |
| `connect`             | WebSocket接続の初期化（認証・再接続ロジック含む）              |
| `sendInput`           | ユーザー入力をWebSocket経由でPTYに送信                         |
| `sendResize`          | ターミナルサイズ変更をWebSocket経由でサーバーに通知            |
| `sendWithModifiers`   | 修飾キー（Ctrl等）と文字を組み合わせて制御コードを送信        |
| `clearModifiers`      | 全修飾キー状態をリセット                                       |
| `handleTextareaSubmit`| textarea内容をPTYに送信（`text + '\r'`）してクリア             |
| `handleResize`        | fitAddonでサイズ計算し、PTYリサイズを通知                      |
| `updateStatus`        | 接続状態UIの更新（connected/disconnected）                     |
| `updateCharCount`     | 拡大モードの文字数カウント表示更新                             |

## 定数（src/constants.js）

| 名前               | 値        | 役割                           |
| ------------------ | --------- | ------------------------------ |
| `MAX_INPUT_LENGTH` | 10000     | 入力テキストの最大長（文字数） |
| `DEFAULT_PORT`     | 3000      | サーバーのデフォルトポート     |
| `MIN_PORT`         | 1024      | ポート番号の最小値             |
| `MAX_PORT`         | 65535     | ポート番号の最大値             |
| `MAX_CONNECTIONS`  | 3         | WebSocket同時接続数の上限      |
| `SAFE_ENV_KEYS`    | 9キーの配列 | PTYに渡す環境変数のホワイトリスト |

## WebSocket メッセージタイプ

| タイプ      | 方向             | 役割                                           |
| ----------- | ---------------- | ---------------------------------------------- |
| `auth`      | Client -> Server | トークン認証（`TINYTERMINAL_TOKEN`設定時のみ）  |
| `input`     | Client -> Server | ユーザー入力をPTYに送信                         |
| `resize`    | Client -> Server | ターミナルサイズ変更（初回はPTY生成トリガー）   |
| `connected` | Server -> Client | 接続/認証成功通知                               |
| `output`    | Server -> Client | PTY出力をxterm.jsに転送                         |
| `exit`      | Server -> Client | PTYプロセス終了通知                             |
| `error`     | Server -> Client | エラーメッセージ（汎用化済み、内部情報を含まない） |

## 入力経路

| 経路             | 実装                        | 用途                                         |
| ---------------- | --------------------------- | -------------------------------------------- |
| xterm.js直接入力 | `terminal.onData(sendInput)` | ターミナルタップ→ソフトキーボードでの直接操作 |
| textarea         | Enter送信 / Shift+Enter改行 | 日本語入力（IME）対応の補助入力              |
| 特殊キーバー     | `data-key`属性 + click      | Esc, Tab, Ctrl, Alt, Shift, 矢印, `/`, `-`  |

## タッチスクロール

| バッファ種別       | 検出方法                                    | 動作                                   |
| ------------------ | ------------------------------------------- | -------------------------------------- |
| 通常バッファ       | `terminal.buffer.active.type !== 'alternate'` | `terminal.scrollLines()` でスクロール  |
| 代替スクリーンバッファ | `terminal.buffer.active.type === 'alternate'` | 矢印キー（`\x1b[A`/`\x1b[B`）に変換  |

## セキュリティ対策

| 項目                     | 実装                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| Origin検証               | `URL.hostname` 厳密一致 + Tailscale CGNAT範囲許可（substring bypass防止） |
| トークン認証             | WebSocket初回メッセージ方式 + `crypto.timingSafeEqual`（タイミング攻撃防止） |
| CSP                      | `script-src`/`style-src`にCDN許可、`connect-src`にws:/wss:許可      |
| CDN整合性検証            | SRIハッシュ + crossorigin属性（xterm.js, @xterm/addon-fit）         |
| 入力バリデーション       | 空文字列拒否、最大長10000文字、null byte検査                        |
| 環境変数ホワイトリスト   | `SAFE_ENV_KEYS`（9キー）のみPTYに渡す。EDITOR/VISUAL除外           |
| PTY遅延起動              | 認証完了 + 初回resize受信までPTY未生成（シェル出力漏洩防止）        |
| パストラバーサル防止     | `path.resolve()` + `startsWith()` でpublicディレクトリ内検証        |
| セキュリティヘッダー     | X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy |
| ログインジェクション防止 | 制御文字・改行をエスケープ（`sanitizeLogMessage`）                  |
| エラーメッセージ汎用化   | クライアントには内部情報を含まない汎用メッセージのみ返却            |
| 接続数制限               | `MAX_CONNECTIONS=3` で同時接続を制限                                |
| URL内トークン除去        | 認証後に`history.replaceState`でURLからtokenパラメータを削除        |
| 認証タイムアウト         | 5秒以内に認証しない接続を自動切断                                   |
