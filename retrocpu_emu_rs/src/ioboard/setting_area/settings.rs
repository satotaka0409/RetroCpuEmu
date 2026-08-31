//! 設定値モデルと正規化ロジック。

use super::constants::{cpu_type, DEFAULT_EMULATE_PORT};

/// 解釈済み設定値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IoBoardSettings {
	/// クロック分周 0..3。
	pub clock_div: u8,
	/// CPU 種類。
	pub cpu_type: u8,
	/// アドレス増加数（1 または 2）。
	pub addr_step: u8,
	/// リセットベクタ（バイトアドレス相当の 32bit。MN1613 は 0x0108）。
	pub reset_vector: u32,
	/// ADDR 7セグ桁数（1-8）。
	pub seven_seg_addr_digits: u8,
	/// DATA 7セグ桁数（1-4）。
	pub seven_seg_data_digits: u8,
	/// エミュレータ受付ポート。
	pub emulate_port: u16,
	/// ステップ実行ディレイカウント。
	pub step_delay: u8,
	/// ブート IHX ファイル名（任意）。
	pub boot: Option<String>,
}

impl Default for IoBoardSettings {
	fn default() -> Self {
		default_settings_for_cpu(cpu_type::MN1613)
	}
}

/// CPU 種類ごとの既定値。
pub fn default_settings_for_cpu(cpu: u8) -> IoBoardSettings {
	match cpu {
		cpu_type::TMS9995 => IoBoardSettings {
			clock_div: 0,
			cpu_type: cpu_type::TMS9995,
			addr_step: 2,
			reset_vector: 0,
			seven_seg_addr_digits: 4,
			seven_seg_data_digits: 4,
			emulate_port: DEFAULT_EMULATE_PORT,
			step_delay: 1,
			boot: None,
		},
		_ => IoBoardSettings {
			clock_div: 0,
			cpu_type: cpu_type::MN1613,
			addr_step: 1,
			reset_vector: 0x0000_0108,
			seven_seg_addr_digits: 5,
			seven_seg_data_digits: 4,
			emulate_port: DEFAULT_EMULATE_PORT,
			step_delay: 1,
			boot: None,
		},
	}
}

/// アドレス増加数を 1 または 2 に正規化する。
pub fn normalize_addr_step(value: u8) -> u8 {
	if value == 2 {
		2
	} else {
		1
	}
}

/// 増加数が 2 のとき奇数アドレスを 1 減算する。
pub fn align_addr_to_step(addr: u32, step: u8) -> u32 {
	if normalize_addr_step(step) == 2 && (addr & 1) == 1 {
		addr.wrapping_sub(1)
	} else {
		addr
	}
}
