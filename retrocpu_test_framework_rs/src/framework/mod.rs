//! CPU 別テストフレームワーク実装。
//!
//! - [`mn1613`] — 実行セッション・CPU ログ・CDB（ワードアドレス）
//! - [`tms9995`] — 成果物セッション・CRU モック・CDB（バイトアドレス）

pub mod disasm;
pub mod mn1613;
pub mod tms9995;

pub use disasm::DisasmResult;
