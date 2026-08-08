# retrocpu_test_framework

MN1613 アセンブラを **Intel HEX + CDB 経由でエミュレータ検証**する独自テストフレームワーク（Vitest は使わない）。

仕様: `.cursor/rules/test_framework.mdc`

ドライバ `.asm` は使わない。呼び出し規約は **第1引数=`R0` / 第2引数=`R1` / 第3引数以降=スタック**。

## テストの置き場

テストはプロジェクトをまたがない。

| プロジェクト | コマンド | 対象 |
| :--- | :--- | :--- |
| 本リポジトリ | `npm test` | `test/*.unit.ts`（フレームワーク単体） |
| `retrocpu_boot_monitor` | `cd ../retrocpu_boot_monitor && npm test` | `mn1613/test/**/*_test.ts`（BIOS／asm） |

BIOS／asm は **1 asm = 1 TS**（`src/handshake/handshake_timer.asm` → `test/handshake/handshake_timer_test.ts`）。HEX / CDB は `mn1613_mon.ihx`（`mn1613_mon_settings.ts`）。IO が必要なら設定の `ioMock`（`mn1613MonHandshakeSettings`）。

## 実行

```bash
cd retrocpu_test_framework
npm install
npm test
```

`npm test` は先に `retrocpu_asm` をビルドし、**このプロジェクトの `test/` だけ**を回す。
