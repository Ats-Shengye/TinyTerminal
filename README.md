# TinyTerminal

スマホのブラウザからPCのシェルをそのまま操作するリモートターミナル。

- xterm.js + node-pty によるフルPTYパススルー
- セキュリティ対策14項目
- テスト126件

> 技術詳細は [GLOSSARY.md](./GLOSSARY.md) を参照

## 概要

Tailscale経由でスマホからPCのシェルを操作するブラウザベースのターミナル。
前身のTinyCC-WebUIがClaude Code特化だったのに対し、任意のCLIツールをそのまま使える汎用設計。
xterm.jsにPTY出力をパススルーするため、ANSIカラー・Tab補完・nvim等のTUIアプリがそのまま動作する。

## 必要環境

- Node.js 18+

## インストール・起動

```bash
npm install
npm start
```

`http://localhost:3000` にアクセス。Tailscale経由の場合は `BIND_ADDRESS=0.0.0.0 npm start`。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `PORT` | サーバーポート | 3000 |
| `BIND_ADDRESS` | バインドアドレス | 127.0.0.1 |
| `TINYTERMINAL_TOKEN` | 認証トークン（設定時はWebSocket接続時に必須） | なし |
| `SHELL` | 起動するシェル | $SHELL or /bin/bash |

## 開発

```bash
npm test          # テスト（126件）
```

## ライセンス

MIT
