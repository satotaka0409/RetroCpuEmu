//! RetroCpu 用アセンブラ（MN1613 / TMS9995）。
//!
//! sdas 互換のソースをパースし、シンボル解決・命令エンコード後に
//! REL / LST 形式へ出力する。`.cpu` または CLI `--cpu` で CPU を選ぶ。
//!
//! MN1613 はワードアドレス（LST）。REL 出力時のみバイトに換算。TMS9995 はバイト。

pub mod area_order;
pub mod assembler;
pub mod cpu_type;
pub mod error;
pub mod expression;
pub mod include;
pub mod lst;
pub mod mn1613;
pub mod parser;
pub mod reloc;
pub mod rel;
pub mod tms9995;
pub mod types;

#[cfg(test)]
mod sample_assemble;

pub use assembler::assemble;
pub use cpu_type::{parse_cpu_type, resolve_cpu_type, scan_source_cpu, CpuType};
pub use error::AsmError;
pub use include::{expand_includes, expand_includes_from_file};
pub use lst::write_lst;
pub use parser::{parse_source, strip_line_comment};
pub use rel::write_rel;
