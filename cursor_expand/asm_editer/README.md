# Retro Assembler Editor（asm_editer）

Cursor / VS Code 向けレトロ CPU **アセンブラ編集**拡張（`cursor_expand/asm_editer`）。  
デバッグ UI は別拡張 [`debug_expand`](../debug_expand/)（`retro-cpu-debug`）で、パッケージ・起動・配布とも独立。

根拠: [`.cursor/rules/asm-rules.mdc`](../../.cursor/rules/asm-rules.mdc)

## 現在の対象

| CPU | 状態 | 拡張子 |
|-----|------|--------|
| MN1610 / MN1613 | 実装中 | `.asm` `.s` `.mn1613` `.mn1610` `.inc` `.h` |
| TMS9995 | 全命令（sdas 構文） | `.asm` `.s` `.tms9995` `.inc` `.h` |
| Z8002 | 予定 | `.z8002` |

## 基礎機能（v0.2）

- **シンタックスハイライト** — 命令・レジスタ・ディレクティブ・ラベル・コメント（TMS9995 全命令含む）
- **チェックポイント** — `; @cp name`（全角 `＠cp` 可）を通常コメントと別色で表示。不正名は診断。CDB / テストログは `retrocpu_test_framework`
- **シンボル索引** — ワークスペース内のラベル / `.equ` を収集（保存時・起動時に再構築）
- **CPU 選択** — 左下ステータスバーで MN1610 / MN1613 / TMS9995 を切替（切替時に索引・診断を再初期化）。アクティブな `.asm` 先頭の `.cpu` があれば自動でそれに合わせる
- **未定義ラベル診断** — 参照先が無いラベルに赤い波線
- **TMS9995 構文診断** — TI 風 `@` / `*R` の拒否、即値の `#`、インデックス R0 禁止、CRU/シフト/XOP の範囲
- **定義へ移動** — ラベル / `.equ` 上で F12、または右クリック「定義へ移動」
- **参照へ移動** — Shift+F12、または右クリック「参照へ移動」
- **呼び出し規約ホバー** — `BAL` / `BL` / `BALD` 等で、JSDoc 風コメント + 規約を表示。TMS9995 は命令ニーモニック上でも Format 説明
- **スニペット** — 規約コメント付きサブルーチン (`sub` / `tmssub`) など

ソース先頭の `.cpu mn1610` / `mn1613` / `tms9995`（コメント・空行を除く最初の行）があれば、それを最優先で解釈します。無ければ `.mn1610` / `.mn1613` / `.tms9995` 拡張子、さらに無ければステータスバーの既定 CPU です。

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

### 呼び出し規約（TMS9995）

- 第1引数 `R1`、第2引数 `R2`（慣用）
- 戻り値 `R1`
- `BL label` で呼び出し、`RT`（`B (R11)`）で復帰
- 構文は sdas: `LI R1, #0x1234`、`(R3)+`、`TAB(R1)`。`@LABEL` / `*R` / `>xxxx` は使わない

`BL SUB` にホバーすると JSDoc と規約が出る。`LI` など命令名にホバーすると Format 説明が出る。

スニペット: `tmsprog` / `tmssub` / `li` / `bl` / `rt`。

### デバッグチェックポイント

```asm
; @cp uart_initialized
        H
        A   R0, R1          ; @cp add_leave
```

- 名前は英数字と `_` のみ（先頭は英字/`_`）。日本語・スペースは不可。
- 色は `workbench.colorCustomizations` の `retroAsm.checkpointForeground` / `retroAsm.checkpointBackground` で変更できる。
- テスト実行時は CDB `L:__CP$name$serial:addr` と CPU ログ（実行前・実行後）に出る。`; @cp` はラベルではない（同一ワードでも可。同名は `$0001` / `$0002`）。

### TODO コメント

```asm
; TODO レジスタをハンドシェイクで送信
        popm                    ; TODO: メインループへ
```

- コメント先頭が `TODO`（大文字小文字不問）のとき、チェックポイントと同様に色分けし、概要ルーラー（左）に印を付ける。
- 色は `retroAsm.todoForeground` / `retroAsm.todoBackground` で変更できる。

## 開発

```bash
cd cursor_expand/asm_editer
npm install
npm run compile
```

マルチルート（`RetroCpuEmu.code-workspace`）では **Run Extension**。  
`asm_editer` フォルダだけ開いているときは **Run Extension (this folder)**。

1. `npm install` 済みであること（`node_modules` が無いと preLaunchTask が失敗する）
2. **F5**
3. Extension Development Host で `retrocpu_boot_monitor` が開き、`.asm` を確認

コマンドパレット:

- `Retro Assembler: Rebuild Symbol Index`
- `Retro Assembler: Show Output`
- `Retro Assembler: Select CPU`

## 構成（他 CPU 展開用）

```
src/
  cpu/           # CpuArchitecture 抽象 + MN1610/MN1613/TMS9995
  symbols/       # ワークスペース索引
  diagnostics/   # 未定義ラベル / アドレッシング / TMS9995 構文
  providers/     # ホバー / 定義・参照へ移動 等
  comments/      # JSDoc 風パーサ / ; @cp
  ui/            # ステータスバー / チェックポイント色分け
  extension.ts
```

## 今後

- [ ] sdcc / gcc デバッグ情報からのシンボル取り込み
- [ ] アセンブル連携（Problems パネル）
