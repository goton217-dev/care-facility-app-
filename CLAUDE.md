# 見守りノート - 開発ガイド

## アプリ概要

**見守りノート**は、高齢の家族の介護施設選びを家族みんなでサポートするWebアプリです。

主な機能：
- 介護施設の登録・比較・評価（12項目）
- 家族間でのコメント・リアクション共有
- バイタル記録（体温・血圧・脈拍・SpO2・体重）
- 日々のケア記録（写真添付可）
- AI秘書アシスタント（Claude Haiku による施設選びアドバイス）

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| バックエンド | Node.js + Express |
| フロントエンド | バニラHTML/JS + Tailwind CSS（CDN） |
| DB | PostgreSQL |
| AI | Anthropic SDK（claude-haiku-4-5-20251001） |
| デプロイ | Render.com |

---

## ファイル構成

```
care-facility-app-/
├── server.js          # Express サーバー・全APIルート（481行）
├── database.js        # DBスキーマ定義・初期データ投入
├── careapp.json       # ローカル開発用サンプルデータ
├── render.yaml        # Render.com デプロイ設定
├── package.json       # 依存パッケージ
└── public/
    ├── index.html          # メインアプリ（SPA・施設比較タブ等）
    ├── kasaneru-feed.html  # フィード画面（ケア記録一覧）
    ├── kasaneru-login.html # ログイン画面
    ├── kasaneru-post.html  # ケア記録投稿画面
    ├── kasaneru-profile.html # プロフィール画面
    └── kasaneru-summary.html # サマリー画面
```

---

## UIの変更方法

**フロントエンドは `public/` 以下のHTMLファイルを直接編集する。**

- スタイルは Tailwind CSS クラスで指定（例：`bg-blue-500`, `text-lg`, `rounded-lg`）
- JavaScriptはHTMLファイル内の `<script>` タグに記述
- APIとの通信は `fetch('/api/...')` を使用

例：ボタンの色変更
```html
<!-- 変更前 -->
<button class="bg-blue-500 text-white ...">ログイン</button>
<!-- 変更後（緑に変更） -->
<button class="bg-green-500 text-white ...">ログイン</button>
```

---

## DBスキーマ（主要テーブル）

| テーブル | 用途 |
|---------|------|
| users | ユーザー（name, pin, role） |
| facilities | 施設情報 |
| evaluations | 施設評価（12項目 × ユーザー） |
| comments | 施設へのコメント |
| vitals | バイタル記録 |
| care_records | ケア記録（JSONB形式・写真配列） |
| record_comments | ケア記録へのコメント |
| record_reactions | ケア記録へのリアクション |

---

## ユーザー情報（初期データ）

| 名前 | PIN | ロール |
|------|-----|--------|
| 長男 | 1111 | family |
| 次男 | 2222 | family |
| 長女 | 3333 | family |
| ケアマネージャー | 9999 | caregiver |

---

## 主要 API エンドポイント

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /api/login | ログイン |
| POST | /api/logout | ログアウト |
| GET | /api/me | 現在のユーザー取得 |
| GET | /api/facilities | 施設一覧 |
| POST | /api/facilities | 施設登録 |
| GET/POST | /api/facilities/:id/evaluations | 施設評価 |
| GET/POST | /api/facilities/:id/comments | 施設コメント |
| GET/POST | /api/vitals | バイタル記録 |
| GET/POST | /api/care-records | ケア記録 |
| POST | /api/assistant | AIアシスタント |

---

## ローカル起動

```bash
npm install
DATABASE_URL=<PostgreSQL接続文字列> npm start
# → http://localhost:3000
```

環境変数：
- `DATABASE_URL`: PostgreSQL接続文字列（必須）
- `ANTHROPIC_API_KEY`: AI機能に必要
- `SESSION_SECRET`: セッション暗号化キー

---

## デプロイ（Render.com）

`render.yaml` に設定済み。mainブランチへのマージで自動デプロイ。

---

## よくある作業例

**ボタンの色を変えたい**
→ 該当HTMLファイルの Tailwind クラスを変更する

**新しい入力項目を追加したい**
→ HTMLにフォーム要素を追加 → server.js のAPIルートで受け取り → DBに保存

**文言を変えたい**
→ 該当HTMLファイルのテキストを直接編集

**施設評価の項目を変えたい**
→ server.js の `evalLabels` オブジェクトと、index.html の評価フォームを両方変更
