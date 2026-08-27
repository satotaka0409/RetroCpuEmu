# retrocpu_test_framework_rs

Rust baseline project derived from `retrocpu_test_framework_ts`.

Current status:

- Implemented pure logic modules:
  - `mn1613::m_sequence`
  - `tms9995::calling_convention`
- Session/emulator-coupled features are currently placeholders and return `NotImplemented`.

## Run tests

```bash
cd retrocpu_test_framework_rs
cargo test
```
