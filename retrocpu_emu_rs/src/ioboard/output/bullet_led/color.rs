//! 砲弾 LED の発光色（`retrocpu_emu_ts/src/renderer/led.ts` と同じトーン）。

use egui::Color32;

/// 砲弾 LED の色種。0–7 は赤、8–A / E / F は橙、B=赤、C=青、D=黄。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LedColor {
	Red,
	Blue,
	Yellow,
	Orange,
	White,
}

/// 1 色種の点灯／消灯トーン。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LedTone {
	/// ハイライト中心。
	pub on_center: Color32,
	/// 点灯時の外周。
	pub on_edge: Color32,
	/// 消灯時の本体。
	pub off: Color32,
	/// 点灯時のグロー（不透明寄り）。
	pub glow: Color32,
}

impl LedColor {
	/// TypeScript `LED_TONES` と同じパレットを返す。
	///
	/// # Returns
	/// - `LedTone` を返します。
	pub fn tone(self) -> LedTone {
		match self {
			Self::Red => LedTone {
				on_center: Color32::from_rgb(0xff, 0x87, 0x87),
				on_edge: Color32::from_rgb(0xff, 0x40, 0x40),
				off: Color32::from_rgb(0x5c, 0x47, 0x47),
				glow: Color32::from_rgba_unmultiplied(255, 64, 64, 230),
			},
			Self::Blue => LedTone {
				on_center: Color32::from_rgb(0x8f, 0xd1, 0xff),
				on_edge: Color32::from_rgb(0x1f, 0x8f, 0xff),
				off: Color32::from_rgb(0x44, 0x56, 0x64),
				glow: Color32::from_rgba_unmultiplied(31, 143, 255, 230),
			},
			Self::Yellow => LedTone {
				on_center: Color32::from_rgb(0xff, 0xf4, 0xa6),
				on_edge: Color32::from_rgb(0xff, 0xd9, 0x4a),
				off: Color32::from_rgb(0x66, 0x5f, 0x46),
				glow: Color32::from_rgba_unmultiplied(255, 217, 74, 242),
			},
			Self::Orange => LedTone {
				on_center: Color32::from_rgb(0xff, 0xd0, 0xa4),
				on_edge: Color32::from_rgb(0xff, 0x9a, 0x3d),
				off: Color32::from_rgb(0x65, 0x53, 0x45),
				glow: Color32::from_rgba_unmultiplied(255, 154, 61, 230),
			},
			Self::White => LedTone {
				on_center: Color32::from_rgb(0xff, 0xff, 0xff),
				on_edge: Color32::from_rgb(0xf0, 0xf4, 0xff),
				off: Color32::from_rgb(0x64, 0x67, 0x6d),
				glow: Color32::from_rgba_unmultiplied(245, 248, 255, 242),
			},
		}
	}
}

/// 砲弾番号 0–15 のパネル既定色。
///
/// 0–7 と B(UNDEF) は赤、8–A / E / F は橙、C=RUN 青、D=HALT 黄。
///
/// # Arguments
/// - `index`: インデックス
///
/// # Returns
/// - `LedColor` を返します。
pub fn default_color_for_index(index: usize) -> LedColor {
	match index {
		0xC => LedColor::Blue,
		0xD => LedColor::Yellow,
		0xB | 0..=7 => LedColor::Red,
		_ => LedColor::Orange,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn panel_colors_match_ts_layout() {
		assert_eq!(default_color_for_index(0), LedColor::Red);
		assert_eq!(default_color_for_index(7), LedColor::Red);
		assert_eq!(default_color_for_index(8), LedColor::Orange);
		assert_eq!(default_color_for_index(0xA), LedColor::Orange);
		assert_eq!(default_color_for_index(0xB), LedColor::Red);
		assert_eq!(default_color_for_index(0xC), LedColor::Blue);
		assert_eq!(default_color_for_index(0xD), LedColor::Yellow);
		assert_eq!(default_color_for_index(0xE), LedColor::Orange);
		assert_eq!(default_color_for_index(0xF), LedColor::Orange);
	}
}
