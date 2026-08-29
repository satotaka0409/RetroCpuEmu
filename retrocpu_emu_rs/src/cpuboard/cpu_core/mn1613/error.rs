//! MN1613 コアで使うエラー型を定義するモジュール。

use core::fmt;

/// MN1613 コア実行エラー。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mn1613Error {
	/// `run_slice` が停止条件なしに命令上限へ達した。
	MaxCyclesReached { cycles: usize },
}

impl fmt::Display for Mn1613Error {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::MaxCyclesReached { cycles } => {
				write!(f, "max cycles reached: {cycles}")
			}
		}
	}
}

impl std::error::Error for Mn1613Error {}
