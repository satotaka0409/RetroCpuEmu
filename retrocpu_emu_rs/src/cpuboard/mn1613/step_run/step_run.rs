//! CPU ボード CPLD 相当のステップ実行ワンショット（ディレイカウンタ方式）
//! 根拠: breakpoint.mdc / MN1613_CPUボードメモリ_IOマップ.mdc（0036/0037）
//!
//! TS 実装（delay-counter）に合わせる。ヒット時は呼び出し側が INT1・INT1_CAUSE=1 を上げる。

/// IO:0036 — ステップ ENABLE（Bit0。ヒット後 CPLD が 0）
pub const IO_PORT_STEP_ENA: u16 = 0x0036;
/// IO:0037 — ステップ割り込みディレイ（8bit）
pub const IO_PORT_STEP_DELAY: u16 = 0x0037;

/// 1 命令ステップ用の既定ディレイ値
pub const STEP_BRK_DELAY_1STEP: u8 = 0x01;

/// ステップ用 CPLD。ENA=1 かつ delay カウントが 0 に達したときワンショットを上げる。
#[derive(Debug, Clone)]
pub struct StepBreakUnit {
	ena: u8,
	delay: u8,
	remaining: u8,
	skip_first_fetch: bool,
}

impl Default for StepBreakUnit {
	fn default() -> Self {
		Self::new()
	}
}

impl StepBreakUnit {
	/// ENA=0・ディレイ初期値で作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			ena: 0,
			delay: STEP_BRK_DELAY_1STEP,
			remaining: 0,
			skip_first_fetch: false,
		}
	}

	/// ENA=0・ディレイ初期値に戻す。
	pub fn reset(&mut self) {
		self.ena = 0;
		self.delay = STEP_BRK_DELAY_1STEP;
		self.remaining = 0;
		self.skip_first_fetch = false;
	}

	/// ENABLE ラッチ（Bit0）。
	///
	/// # Returns
	/// - 8bit 値を返します。
	pub fn enable(&self) -> u8 {
		self.ena
	}

	/// ラッチされたディレイ値（8bit）。
	///
	/// # Returns
	/// - 8bit 値を返します。
	pub fn delay_count(&self) -> u8 {
		self.delay
	}

	/// 現在の残りカウント（テスト用）。
	///
	/// # Returns
	/// - 8bit 値を返します。
	pub fn remaining_count(&self) -> u8 {
		self.remaining
	}

	/// 1 命令の先頭語フェッチ。2 語目やオペランド READ では呼ばない。
	///
	/// # Arguments
	/// - `_word`: フェッチした命令語（16bit。現状未使用）
	///
	/// # Returns
	/// - ヒットしたら `true`（ENA は内部で 0 へ戻る）。
	pub fn on_instruction_fetch(&mut self, _word: u16) -> bool {
		if self.ena == 0 {
			return false;
		}

		// 仕様: DELAY 書き込み後の次クロックからカウント開始。
		// エミュでは「次の命令フェッチから開始」として扱う。
		if self.skip_first_fetch {
			self.skip_first_fetch = false;
			return false;
		}

		if self.remaining > 0 {
			self.remaining = self.remaining.wrapping_sub(1);
		}
		if self.remaining == 0 {
			self.ena = 0;
			return true;
		}
		false
	}

	/// IO リード（0036/0037）。対象外は None。
	///
	/// # Arguments
	/// - `port`: ポート番号
	///
	/// # Returns
	/// - 値が存在すれば `Some(value)`、なければ `None` を返します。
	pub fn read_port(&self, port: u16) -> Option<u16> {
		match port & 0xffff {
			IO_PORT_STEP_ENA => Some(u16::from(self.ena)),
			IO_PORT_STEP_DELAY => Some(u16::from(self.delay)),
			_ => None,
		}
	}

	/// IO ライト（0036/0037）。
	/// ENA=1 で現在の delay 値を再ロードしてカウント開始する。
	///
	/// # Arguments
	/// - `port`: ポート番号
	/// - `val`: 16bit 値
	///
	/// # Returns
	/// - 対応ポートを処理した場合は `true`。
	pub fn write_port(&mut self, port: u16, val: u16) -> bool {
		let p = port & 0xffff;
		let v = val & 0xffff;
		match p {
			IO_PORT_STEP_ENA => {
				self.ena = (v & 1) as u8;
				if self.ena != 0 {
					// 実機の「次クロックから」を命令フェッチ近似すると 1 命令早く
					// 発火しやすいため、+1 オフセットで整合を取る（TS と同じ）。
					self.remaining = self.delay.wrapping_add(1);
					self.skip_first_fetch = true;
				} else {
					self.remaining = 0;
					self.skip_first_fetch = false;
				}
				true
			}
			IO_PORT_STEP_DELAY => {
				self.delay = (v & 0xff) as u8;
				true
			}
			_ => false,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn fires_after_delay_fetches() {
		let mut step = StepBreakUnit::new();
		step.write_port(IO_PORT_STEP_DELAY, 1);
		step.write_port(IO_PORT_STEP_ENA, 1);
		// skip first
		assert!(!step.on_instruction_fetch(0x1000));
		// remaining: 2 → 1
		assert!(!step.on_instruction_fetch(0x1001));
		// remaining: 1 → 0 → hit
		assert!(step.on_instruction_fetch(0x1002));
		assert_eq!(step.enable(), 0);
	}

	#[test]
	fn disabled_never_fires() {
		let mut step = StepBreakUnit::new();
		assert!(!step.on_instruction_fetch(0x2000));
	}
}
