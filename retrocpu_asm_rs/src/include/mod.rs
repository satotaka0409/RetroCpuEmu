//! `.include` / `INCLUDE` の再帰展開。
//!
//! エントリ `.asm` を読み、include 行を子ファイル内容へ置換する。
//! 循環 include は検出してエラーにする。

mod expand;
mod operand;

pub use expand::{expand_includes, expand_includes_from_file};
