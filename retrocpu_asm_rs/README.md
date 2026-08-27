# retrocpu_asm_rs

Rust port baseline of [retrocpu_asm_ts](../retrocpu_asm_ts).

Current status:

- Implemented:
  - CLI (`retrocpu_asm`)
  - `.cpu` detection / CPU resolution
  - Recursive `.include` expansion
  - Expression evaluator (number formats, unary/binary operators)
  - Basic directives: `.org`, `.equ`, `.word`/`.dw`, `.ds`, `.blkw`
  - Basic symbol table and listing / rel output writers
- Not implemented yet:
  - Full MN1613/TMS9995 instruction encoding compatibility
  - sdld linker integration and full REL record compatibility with TS version
  - Macro system and checkpoint features

## Build

```bash
cd retrocpu_asm_rs
cargo build
```

## Test

```bash
cd retrocpu_asm_rs
cargo test
```

## CLI

```bash
cd retrocpu_asm_rs
cargo run --bin retrocpu_asm -- --cpu mn1613 path/to/input.asm
```
