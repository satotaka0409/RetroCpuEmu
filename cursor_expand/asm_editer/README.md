# Retro Assembler Editor

Cursor / VS Code 向けレトロ CPU アセンブラ編集拡張（`cursor_expand/asm_editer`）。

根拠: [`.cursor/rules/asm-rules.mdc`](../../.cursor/rules/asm-rules.mdc)

## 現在の対象

| CPU | 状態 | 拡張子 |
|-----|------|--------|
| MN1610 / MN1613 | 実装中 | `.asm` `.s` `.mn1613` `.mn1610` `.inc` `.h` |
| TMS9995 | 第1弾（命令診断・ホバー） | `.asm` `.s` `.tms9995` `.inc` `.h` |
| Z8002 | 予定 | `.z8002` |

## 基礎機能（v0.2）

- **シンタックスハイライト** — 命令・レジスタ・ディレクティブ・ラベル・コメント
- **シンボル索引** — ワークスペース内のラベル / `.equ` を収集（保存時・起動時に再構築）
- **CPU 選択** — 左下ステータスバーで MN1610 / MN1613 / TMS9995 を切替（切替時に索引・診断を再初期化）
- **未定義ラベル診断** — 参照先が無いラベルに赤い波線
- **定義へ移動** — ラベル / `.equ` 上で F12、または右クリック「定義へ移動」
- **参照へ移動** — Shift+F12、または右クリック「参照へ移動」
- **呼び出し規約ホバー** — `BAL` / `BL` / `BALD` 等で、JSDoc 風コメント + 規約を表示
- **スニペット** — 規約コメント付きサブルーチン (`sub`) など

`.asm` / `.s` / `.inc` / `.h` はステータスバーの CPU で命令を解釈します。`.mn1610` / `.mn1613` / `.tms9995` は拡張子を優先します。

### 呼び出し規約（MN1613）

- 第1引数 `R0`、第2引数 `R1`、以降はスタック
- 戻り値 `R0`
- `R4`〜`R7` を壊す場合は入口/出口で退避・復元

### サブルーチンコメント例

```asm
;; @brief 加算
;; @param R0 加数 A
;; @param R1 加数 B
;; @return R0 和
ADD:
        A   R0, R1
        RET
```

`BAL ADD` にホバーすると上記と呼び出し規約が表示されます。

## 開発

```bash
cd cursor_expand/asm_editer
npm install
npm run compile
```

1. Cursor でこのフォルダを開く
2. **F5**（Run Extension）
3. `.asm` / `.mn1613` を開いて動作確認

コマンドパレット:

- `Retro Assembler: Rebuild Symbol Index`
- `Retro Assembler: Show Output`
- `Retro Assembler: Select CPU`

## 構成（他 CPU 展開用）

```
src/
  cpu/           # CpuArchitecture 抽象 + MN1613 定義
  symbols/       # ワークスペース索引
  diagnostics/   # 未定義ラベル
  providers/     # ホバー / 定義・参照へ移動 等
  comments/      # JSDoc 風パーサ
  extension.ts
```

## 今後

- [ ] TMS9995 アーキテクチャ定義の追加
- [ ] sdcc / gcc デバッグ情報からのシンボル取り込み
- [ ] アセンブル連携（Problems パネル）
