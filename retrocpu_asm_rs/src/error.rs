//! アセンブルエラー型。

use std::error::Error;
use std::fmt::{Display, Formatter};

/// アセンブル失敗（パース・式評価・命令エンコード・include 等）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsmError {
	message: String,
}

impl AsmError {
	/// 表示用メッセージからエラーを作る。
	pub fn new(msg: impl Into<String>) -> Self {
		Self {
			message: msg.into(),
		}
	}
}

impl Display for AsmError {
	fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}", self.message)
	}
}

impl Error for AsmError {}
