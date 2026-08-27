# retrocpu_test_framework_rs

Rust baseline project derived from `retrocpu_test_framework_ts`.

Current status:

- Implemented Rust ports for pure utility modules:
  - `assert`
  - `expand_includes`
  - `cpu_log_mark`
  - `unit`
  - `checkpoint`
  - `hex_cdb`
  - `json_suite`
  - `mn1613::m_sequence`
  - `mn1613::heap`
  - `mn1613::cpu_log_clear`
  - `tms9995::calling_convention`
  - `tms9995::cdb`
  - `tms9995::session` (artifact/session utilities)
- Remaining CPU emulator-coupled runtime features are still placeholders and return `NotImplemented`.

## Run tests

```bash
cd retrocpu_test_framework_rs
cargo test
```
