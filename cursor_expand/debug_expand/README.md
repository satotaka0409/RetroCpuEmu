# Retro CPU Debug（debug_expand）

Cursor / VS Code 向けレトロ CPU **デバッグ**拡張（`cursor_expand/debug_expand`）。  
アセンブラ編集は別拡張 [`retrocpu_asm_editor`](../retrocpu_asm_editor/)（`retro-asm-editor`）で、パッケージ・起動・配布とも独立。

根拠: [`.cursor/rules/retrocpu_debug.mdc`](../../.cursor/rules/retrocpu_debug.mdc)  
通信原案: [`.cursor/rules/retrocpu_debug_expand_protocol.mdc`](../../.cursor/rules/retrocpu_debug_expand_protocol.mdc)

## 現状（v0.1）

- **基本画面**（`retrocpu_debug.mdc`）
  - 左: レジスタ（現在 / 履歴 0–7 / スロット 0–7）＋ BP 一覧（比較器 0–7 の 1 プール）
  - 右上: 逆アセンブラ、その下にブレイク情報
  - 下: メモリダンプ（物理ワード **16進5桁**、データ **16進4桁** × **16ワード/行**）
  - 表示位置の **±800h ワード**を IO→CPU ハンドシェイク `13h` で取得。スクロールが窓の端に出たら再取得
  - ダンプ上の右クリック → 「アドレス指定…」で先頭アドレスを変更
- **Intel HEX + CDB 読込**（`読込` ボタンまたは `Retro CPU Debug: Load Intel HEX / CDB`）
  - HEX をメモリに展開し、同名 `.cdb` があれば自動読込（無ければ選択）
  - 逆アセンブル先頭は CDB の `g_main`。無ければ HEX 最小アドレス
  - アセンブラソースは表示しない

接続・実行・ブレイク実設定は未実装。

```text
+----------+-------------------------------------+
| レジスタ  | 逆アセンブラ                          |
| (タブ)   |                                     |
+----------+-------------------------------------+
| メモリ    | ブレイク情報                          |
| ダンプ    |                                     |
+----------+-------------------------------------+
```

レジスタタブ:

- **現在** / 履歴 **0–7** / 比較器スロット **0–7**

## 使い方（Extension Development Host）

いまの Cursor ウィンドウはそのまま（デバッガ側）。**別ウィンドウ** `[Extension Development Host]` が拡張機能モードです。

```bash
cd cursor_expand/debug_expand
npm install
npm run compile
```

1. **`RetroCpuEmu.code-workspace` を開く**（マルチルート）
2. 左の **Run and Debug**（または `Ctrl+Shift+D`）
3. ドロップダウンで **`Run Extension: retro-cpu-debug`** を選ぶ  
   （`retrocpu_asm_editor` の Run Extension と取り違えない）
4. **F5**（または緑の ▶）
5. タイトルに **`[Extension Development Host]`** と付いた **新しい Cursor 窓**が開く  
   → そこでデバッグ UI（「Retro CPU Debug」パネル）が自動表示される

Host 側で手動再表示する場合: コマンドパレット → `Retro CPU Debug: Open Debug View`

変更を入れたあと Host だけ再読込: Host 窓で `Developer: Reload Window`（または親窓で `Ctrl+Shift+F5`）。

## 今後

1. Intel HEX / `.cdb` 読込 → 逆アセンブル・ソース対応
2. IO ボード TCP（`127.0.0.1:23540`）接続
3. 命令ブレイク（逆アセンブラ）/ メモリ・IO ブレイク UI
4. `; @cp` チェックポイント強調（`asm_editor.mdc`）
