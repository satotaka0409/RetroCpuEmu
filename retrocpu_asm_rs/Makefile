# retrocpu_asm_rs — Rust アセンブラ
#
#   make / make build   ライブラリをビルド
#   make test           ユニットテスト + sample/ 受理テスト
#   make test-lib       ライブラリ内ユニットテスト（sample 除く）
#   make test-sample    sample/*.asm アセンブル smoke テスト
#   make check          cargo check（lib）
#   make release        リリースビルド（lib）
#   make snapshot       asm_snapshot を実行（ARGS= で引数を渡す）
#   make clean
#
# 注: Cargo.toml に retrocpu_asm バイナリが登録されているが、
#     src/bin/retrocpu_asm.rs は未実装のため、現状は --lib のみビルドする。

.PHONY: all build test test-lib test-sample check release snapshot clean help

all: build

build:
	cargo build --lib

test: test-lib test-sample

test-lib:
	cargo test --lib -- --skip sample_assemble

test-sample:
	cargo test --lib sample_assemble

check:
	cargo check --lib

release:
	cargo build --release --lib

snapshot:
	cargo run --bin asm_snapshot -- $(ARGS)

clean:
	cargo clean

help:
	@echo "retrocpu_asm_rs"
	@echo "  make build              cargo build --lib"
	@echo "  make test               test-lib + test-sample"
	@echo "  make test-lib           cargo test --lib（sample 除く。encoder 全命令含む）"
	@echo "  make test-sample        sample/*.asm 受理 smoke"
	@echo "  make check              cargo check --lib"
	@echo "  make release            cargo build --release --lib"
	@echo "  make snapshot ARGS=...  cargo run --bin asm_snapshot"
	@echo "  make clean              cargo clean"
