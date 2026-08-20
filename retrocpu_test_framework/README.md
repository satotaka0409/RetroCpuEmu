# retrocpu_test_framework

MN1613 / TMS9995 向けの **Intel HEX + CDB** テスト補助ライブラリ（Vitest は使わない）。

- MN1613: アセンブル補助 + エミュ実行セッション（`Mn1613AsmSession`）
- TMS9995: アセンブル／リンク補助（`assembleAndLink` / `assembleToHexCdb`）

TMS9995 では CRU ハンドシェイク領域モックも利用できる。

- `Tms9995CruHandshakeMock`: CRU 0x0024..0x003F の信号線・データ線を役割付きで検証
- `TMS9995_CRU_HANDSHAKE_SIGNALS`: 信号名→ビットアドレス対応
- `TMS9995_CRU_HANDSHAKE_REGION`: 領域定数

仕様: `.cursor/rules/asm_test_framework.mdc`

MN1613 固有（セッション、M系列メモリ埋め、CPU ログ、MAIN スタブ）は `src/mn1613/`。
TMS9995 は現状、実行セッションは未実装（エミュ実行は MN1613 のみ）。

**テスト対象として読んでよいのは `.ihx` と `.cdb` のみ。** セッション作成は `.asm` を読まない。
アセンブル／リンクは Makefile 等で事前に行い、成果物パスを設定に書く。

テスト専用 CPU ログは設定の `cpuLogFile` で有効化する。未指定なら出力しない。
`cpuLogMode` で本文を選ぶ（省略時はタイトルのみ）:

| 指定            | 出力                                    |
| :-------------- | :-------------------------------------- |
| （指定なし）    | ケースタイトルの `START` / `END` のみ   |
| `"checkpoint"`  | `; @cp` 箇所のみ。実行前・実行後の 2 行 |
| `"instruction"` | 全命令。実行後のみ 1 行                 |

`; @cp <name>` はアセンブララベルではない。`retrocpu_asm` が `.rel` に `L:__CP$name$serial:addr` を出す（同名は `$0001` / `$0002`。同一ワードでも可）。
チェックポイント欄は `name$serial`（例 `add_enter$0001`）。`instruction` で非 `@cp` なら `-`。
各 `test()` ケースはタイトルを `START` / `END` で囲む。
CLI は全体実行の開始時に、対象が `test/mn1613` 配下なら `logs/mn1613/*.log` を削除する。

ドライバ `.asm` は使わない。呼び出し規約は **第1引数=`R0` / 第2引数=`R1` / 第3引数=`R2` / 第4引数以降=スタック / 戻り値=`R0`–`R2`**。

## テストの置き場

テストはプロジェクトをまたがない。

| プロジェクト            | コマンド                                  | 対象                                    |
| :---------------------- | :---------------------------------------- | :-------------------------------------- |
| 本リポジトリ            | `npm test`                                | `test/*.unit.ts`（フレームワーク単体）  |
| `retrocpu_boot_monitor` | `cd ../retrocpu_boot_monitor && npm test` | `test/mn1613/**/*_test.ts`（BIOS 結合） |

BIOS 結合は Makefile 成果物 `mn1613_mon.ihx` / `mn1613_mon.cdb`（`mn1613_mon_settings.ts`）をロードする。IO が必要なら設定の `ioMock`（`mn1613MonHandshakeSettings`）。

フレームワーク単体で `assembleToHexCdb` を使うのは、ハーネス自身の検証用（一時 HEX/CDB を書いてからセッションを開く）に限る。

## 実行

```bash
cd retrocpu_test_framework
npm install
npm test
```

`npm test` は先に `retrocpu_asm` をビルドし、**このプロジェクトの `test/` だけ**を回す。

`retrocpu_boot_monitor` の `npm test` は開始時に `logs/mn1613/*.log` を消してから結合テストを実行する（先に `make` で HEX/CDB を用意すること）。
