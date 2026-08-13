# Retro CPU Debug（debug_expand）

Cursor / VS Code 向けレトロ CPU **デバッグ**拡張（`cursor_expand/debug_expand`）。  
アセンブラ編集は別拡張 [`asm_editer`](../asm_editer/)（`retro-asm-editor`）で、パッケージ・起動・配布とも独立。

根拠: [`.cursor/rules/retrocpu_debug.mdc`](../../.cursor/rules/retrocpu_debug.mdc)  
通信原案: [`.cursor/rules/retrocpu_debug_expand_protocol.mdc`](../../.cursor/rules/retrocpu_debug_expand_protocol.mdc)

## 現状（v0.1）

- **基本画面**（レジスタ / 逆アセンブル / ソース / BP / メモリダンプ）
- **Intel HEX + CDB 読込**（`読込` ボタンまたは `Retro CPU Debug: Load Intel HEX / CDB`）
  - HEX をメモリに展開し、同名 `.cdb` があれば自動読込（無ければ選択）
  - エントリは CDB の `main` / `run`（なければ `g_main` / `gl_main`）、それも無ければ HEX 最小アドレス
  - エントリ周辺を逆アセンブル＋メモリダンプ。ラベル定義のある `.asm` をワークスペースから探してソース表示

接続・実行・ブレイク実設定は未実装。

```text
+----------+------------------+------------------+
| レジスタ  | 逆アセンブラ      | アセンブラソース   |
| (タブ)   |                  |                  |
+----------+------------------+------------------+
| BP一覧   | ブレイク情報（横幅共用）              |
+----------+-------------------------------------+
| メモリダンプ（全幅）                             |
+------------------------------------------------+
```

レジスタタブ（仕様どおり）:

- **現在** / 履歴 **0–7** / **命令 0–7** / **アド 0–5**

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
   （`asm_editer` の Run Extension と取り違えない）
4. **F5**（または緑の ▶）
5. タイトルに **`[Extension Development Host]`** と付いた **新しい Cursor 窓**が開く  
   → そこでデバッグ UI（「Retro CPU Debug」パネル）が自動表示される

Host 側で手動再表示する場合: コマンドパレット → `Retro CPU Debug: Open Debug View`

変更を入れたあと Host だけ再読込: Host 窓で `Developer: Reload Window`（または親窓で `Ctrl+Shift+F5`）。

## 今後

1. Intel HEX / `.cdb` 読込 → 逆アセンブル・ソース対応
2. IO ボード TCP（`127.0.0.1:23540`）接続
3. 命令ブレイク（逆アセンブラ）/ メモリ・IO ブレイク UI
4. `; @cp` チェックポイント強調（`asm_editer.mdc`）
