//! 設定エリアの定数群。

/// 設定エリアサイズ（NOR 後半 256 バイト）。
pub const SETTING_AREA_SIZE: usize = 256;
/// 有効マーク `0xAA55`。
pub const SETTING_MARK: u16 = 0xaa55;
/// エミュレータ受付ポート既定（0x7148 = 29000）。
pub const DEFAULT_EMULATE_PORT: u16 = 0x7148;

/// 設定エリア内オフセット。
pub mod offsets {
	/// マーク上位。
	pub const MARK_HI: usize = 0x00;
	/// マーク下位。
	pub const MARK_LO: usize = 0x01;
	/// クロック分周。
	pub const CLOCK_DIV: usize = 0x02;
	/// CPU 種類。
	pub const CPU_TYPE: usize = 0x03;
	/// CPU 種類再設定。
	pub const CPU_TYPE_RESET: usize = 0x04;
	/// アドレス増加数。
	pub const ADDR_STEP: usize = 0x05;
	/// リセットベクタ先頭。
	pub const RESET_VECTOR_0: usize = 0x06;
	/// ADDR 7セグ桁。
	pub const SEVEN_SEG_ADDR_DIGITS: usize = 0x0a;
	/// DATA 7セグ桁。
	pub const SEVEN_SEG_DATA_DIGITS: usize = 0x0b;
	/// エミュポート上位。
	pub const EMULATE_PORT_HI: usize = 0x0c;
	/// ステップ遅延。
	pub const STEP_DELAY: usize = 0x0e;
}

/// CPU 種類コード。
pub mod cpu_type {
	/// MN1613。
	pub const MN1613: u8 = 1;
	/// TMS9995。
	pub const TMS9995: u8 = 2;
}
