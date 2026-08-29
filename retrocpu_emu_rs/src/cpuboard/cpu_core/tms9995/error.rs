//! TMS9995 コアで使うエラー型を定義するモジュール。

use core::fmt;

/// TMS9995 実行時エラー。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tms9995Error {
	/// 未実装または不正な命令語に遭遇した。
	IllegalInstruction { pc: u16, ir: u16 },
	/// 停止条件に到達せず、許可した命令実行数を使い切った。
	MaxCyclesReached { cycles: usize },
}

impl fmt::Display for Tms9995Error {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::IllegalInstruction { pc, ir } => {
				write!(f, "illegal instruction: pc=0x{pc:04X} ir=0x{ir:04X}")
			}
			Self::MaxCyclesReached { cycles } => {
				write!(f, "max cycles reached: {cycles}")
			}
		}
	}
}

impl std::error::Error for Tms9995Error {}
