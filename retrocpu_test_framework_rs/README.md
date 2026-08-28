# retrocpu_test_framework_rs

Rust port of [`retrocpu_test_framework_ts`](../retrocpu_test_framework_ts).

MN1613 / TMS9995 向け **Intel HEX + CDB** テスト補助ライブラリ（Vitest は使わない）。

- MN1613: アセンブル + リンク + エミュ実行セッション（`Mn1613AsmSession` / `create_session_from_settings`）
- TMS9995: アセンブル／リンク + **成果物セッション**（`Tms9995ArtifactSession`）
  - シンボル解決・メモリ読取・呼び出し規約プラン・CRU モックまで
  - **`call` / `runInit` は未実装**（`retrocpu_emu_rs` に TMS9995 CPU コアが無い）

仕様: `.cursor/rules/asm_test_framework.mdc`

## Features

- **Utilities**: `assert`, `expand_includes`, `checkpoint`, `hex_cdb`, `json_suite`, `unit` test registry
- **CDB**: MN1613 `parse_cdb` / TMS9995 `parse_tms9995_cdb`
- **Assemble + link**: `assemble_and_link` via `retrocpu_asm_rs` + `sdld`（XH2 REL 出力）
- **MN1613 session**: load HEX/CDB, `run_init`, `call`, `expect_*`, CPU ログ
- **Handshake mock**: `IoBoardHandshakeMock` — 線シミュレーション + CPU→IO コマンド dispatch（10h–1Fh）
- **TMS9995**: calling convention planner, artifact session, CRU handshake mock

## テスト対象

**`.ihx` と `.cdb` のみ**を読む。セッション作成は `.asm` を読まない。
アセンブル／リンクは Makefile 等で事前に行い、成果物パスを設定に書く。

## cpuLogMode

設定の `cpuLogFile` で有効化。未指定なら出力しない。

| 指定 | 出力 |
| :--- | :--- |
| （指定なし） | ケースタイトルの `START` / `END` のみ |
| `Checkpoint` | `; @cp` 箇所のみ。実行前・実行後の 2 行 |
| `Instruction` | 全命令。実行後のみ 1 行 |

`; @cp <name>` はアセンブララベルではない。フレームワークが `inject_checkpoints` で挿入し、リンク後 CDB に `L:__CP$name$serial:addr` を載せる。

各 `#[test]` では `begin_cpu_log_test(name)` / `end_cpu_log_test(name)` でタイトル行を囲める。

## Handshake mock

`JsonTestSettings.ioMock` に `{ "type": "handshake" }` を指定すると、MN1613 ポート `0x20`–`0x25` の線シミュレーションと CPU→IO コマンド dispatch が有効になる。

BIOS 結合テストでは TS と同様、CPU 実行と並行して mock 側が応答する:

```rust
let mock = session.require_handshake_mock()?;
// 別スレッドまたは run_slice を poll に渡して:
mock.handle_one_request(&mut || { /* CPU を進める */ })?;
```

`dispatch_cpu_to_io` で線なしの応答生成のみも可能。IO→CPU（80h–89h）とタイマー割り込みは今後拡張。

## Run tests

```bash
cd retrocpu_test_framework_rs
cargo test -- --test-threads=1
```

`--test-threads=1` は CPU ログのグローバルマーカー競合を避けるため推奨。

Optional CLI:

```bash
cargo run --bin retrocpu_test_framework
```

## sdld

`assemble_and_link` requires SDCC `sdld` on PATH or in `SDCC_BIN_DIR` / `SDLD`.
Install via `make sdcc-setup` in the boot monitor / asm build flow.
Integration tests skip gracefully when `sdld` is missing.

## Session from JSON settings

```rust
use retrocpu_test_framework_rs::json_value::JsonTestSettings;
use retrocpu_test_framework_rs::mn1613::create_session_from_settings;

let session = create_session_from_settings(&settings, Some(base_dir.as_path()))?;
session.run_init()?;
session.call("g_get_rnd", Default::default())?;
```

Production BIOS tests still use pre-built `.ihx` / `.cdb` (see `asm_test_framework.mdc`).

## 呼び出し規約（MN1613）

第1=`R0` / 第2=`R1` / 第3=`R2` / 第4以降=スタック / 戻り値=`R0`–`R2`。TMS9995 は `asm_rules.mdc`（第1=`R2`…）。

## テスト配置

| プロジェクト | コマンド | 対象 |
| :--- | :--- | :--- |
| 本リポジトリ | `cargo test` | `src/**` unit + `tests/**` integration |
| `retrocpu_boot_monitor` | `npm test` | `test/mn1613/**/*_test.ts`（Rust 版は今後） |
