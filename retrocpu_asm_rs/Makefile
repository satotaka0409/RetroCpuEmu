# retrocpu_asm_rs — Rust アセンブラ
#
#   make / make build   ライブラリをビルド
#   make test           ユニットテスト（lib）
#   make check          cargo check（lib）
#   make release        リリースビルド（lib）
#   make snapshot       asm_snapshot を実行（ARGS= で引数を渡す）
#   make clean
#
# 注: Cargo.toml に retrocpu_asm バイナリが登録されているが、
#     src/bin/retrocpu_asm.rs は未実装のため、現状は --lib のみビルドする。

.PHONY: all build test check release snapshot clean help

all: build

build:
	cargo build --lib

test:
	cargo test --lib

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
	@echo "  make test               cargo test --lib"
	@echo "  make check              cargo check --lib"
	@echo "  make release            cargo build --release --lib"
	@echo "  make snapshot ARGS=...  cargo run --bin asm_snapshot"
	@echo "  make clean              cargo clean"
