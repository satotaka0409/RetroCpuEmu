//! 7セグ 1 桁の 8bit パターン（a..g + dp）と 16 進フォント。
//!
//! 根拠: `HandShake.mdc` の `16h`、`.cursor/rules/seven_segment_bit_map.svg`、
//! `retrocpu_emu_ts/src/ioboard/seven_led/seg_font.ts`。

/// 上段水平（a）。
pub const SEG_A: u8 = 1 << 0;
/// 右上垂直（b）。
pub const SEG_B: u8 = 1 << 1;
/// 右下垂直（c）。
pub const SEG_C: u8 = 1 << 2;
/// 下段水平（d）。
pub const SEG_D: u8 = 1 << 3;
/// 左下垂直（e）。
pub const SEG_E: u8 = 1 << 4;
/// 左上垂直（f）。
pub const SEG_F: u8 = 1 << 5;
/// 中段水平（g）。
pub const SEG_G: u8 = 1 << 6;
/// 小数点（dp）。
pub const SEG_DP: u8 = 1 << 7;

/// IO ボード設定エリア編集モードの先頭桁（g のみ）。
pub const SEG_DASH: u8 = SEG_G;

/// ADDR 部の桁数。
pub const ADDR_DIGIT_COUNT: usize = 8;
/// DATA 部の桁数。
pub const DATA_DIGIT_COUNT: usize = 4;
/// 7セグ全体の桁数（ADDR 8 + DATA 4）。ハンドシェイク `16h` と同じ。
pub const DIGIT_COUNT: usize = ADDR_DIGIT_COUNT + DATA_DIGIT_COUNT;

/// `0`〜`F` の標準 7セグパターン（dp は含まない、bit0..6 のみ）。
const HEX_FONT: [u8; 16] = [
	0x3f, // 0: a b c d e f
	0x06, // 1: b c
	0x5b, // 2: a b d e g
	0x4f, // 3: a b c d g
	0x66, // 4: b c f g
	0x6d, // 5: a c d f g
	0x7d, // 6: a c d e f g
	0x07, // 7: a b c
	0x7f, // 8: a b c d e f g
	0x6f, // 9: a b c d f g
	0x77, // A: a b c e f g
	0x7c, // B: c d e f g
	0x39, // C: a d e f
	0x5e, // D: b c d e g
	0x79, // E: a d e f g
	0x71, // F: a e f g
];

/// 指定ビットが点灯しているか。
///
/// `mask` は `SEG_A` などの 1 ビット。`pattern` は 8bit（bit0=a … bit7=dp）。
#[inline]
pub fn segment_on(pattern: u8, mask: u8) -> bool {
	(pattern & mask) != 0
}

/// 16 進ニブル（0〜15）を 7セグパターンへ変換する。
///
/// `nibble` は下位 4bit のみ使う。戻りは a..g（dp は 0）。
#[inline]
pub fn hex_nibble_to_seg(nibble: u8) -> u8 {
	HEX_FONT[(nibble & 0x0f) as usize]
}

/// 16 進 1 文字を 7セグパターンへ変換する。
///
/// `'0'`〜`'9'` / `'A'`〜`'F'`（小文字可）。未知の文字は 0（消灯）。
pub fn hex_digit_to_seg(ch: char) -> u8 {
	match ch {
		'0'..='9' => HEX_FONT[(ch as u8 - b'0') as usize],
		'A'..='F' => HEX_FONT[(ch as u8 - b'A' + 10) as usize],
		'a'..='f' => HEX_FONT[(ch as u8 - b'a' + 10) as usize],
		_ => 0,
	}
}

/// 16 進ニブルに小数点ビットを載せる。
///
/// `nibble` は 0〜15。`dp` が真なら bit7 を立てる。
#[inline]
pub fn hex_nibble_to_seg_with_dp(nibble: u8, dp: bool) -> u8 {
	let mut pat = hex_nibble_to_seg(nibble);
	if dp {
		pat |= SEG_DP;
	}
	pat
}

/// 数値を 16 進表示し、左（上位）から `width` 桁の 7セグパターンを返す。
///
/// 足りない上位は `'0'` で埋める。`width` を超える分は下位を採用する。
/// `width` が 0 なら空。各桁の dp は 0。
pub fn word_to_seg_digits(value: u32, width: usize) -> Vec<u8> {
	if width == 0 {
		return Vec::new();
	}
	(0..width)
		.map(|i| {
			let bit = (width - 1 - i).saturating_mul(4);
			let nibble = if bit >= 32 {
				0
			} else {
				((value >> bit) & 0x0f) as u8
			};
			hex_nibble_to_seg(nibble)
		})
		.collect()
}

/// 設定桁数だけ点灯し、余った上位桁は消灯した列を作る。
///
/// `used_digits` は点灯させる桁数（1〜`total_digits` にクランプ）。
/// `total_digits` はフィールド全体（ADDR=8 / DATA=4）。
/// 上位の未使用桁は 0（消灯）。使用桁は 16 進 0 埋め。
pub fn word_to_seg_digits_padded(value: u32, used_digits: usize, total_digits: usize) -> Vec<u8> {
	let total = total_digits.max(1);
	let used = used_digits.clamp(1, total);
	let digits = word_to_seg_digits(value, used);
	if digits.len() >= total {
		return digits[digits.len() - total..].to_vec();
	}
	let mut out = vec![0u8; total - digits.len()];
	out.extend_from_slice(&digits);
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hex_font_matches_ts_seg_font() {
		assert_eq!(hex_nibble_to_seg(0x0), 0x3f);
		assert_eq!(hex_nibble_to_seg(0x1), 0x06);
		assert_eq!(hex_nibble_to_seg(0x2), 0x5b);
		assert_eq!(hex_nibble_to_seg(0x3), 0x4f);
		assert_eq!(hex_nibble_to_seg(0x4), 0x66);
		assert_eq!(hex_nibble_to_seg(0x5), 0x6d);
		assert_eq!(hex_nibble_to_seg(0x6), 0x7d);
		assert_eq!(hex_nibble_to_seg(0x7), 0x07);
		assert_eq!(hex_nibble_to_seg(0x8), 0x7f);
		assert_eq!(hex_nibble_to_seg(0x9), 0x6f);
		assert_eq!(hex_nibble_to_seg(0xa), 0x77);
		assert_eq!(hex_nibble_to_seg(0xb), 0x7c);
		assert_eq!(hex_nibble_to_seg(0xc), 0x39);
		assert_eq!(hex_nibble_to_seg(0xd), 0x5e);
		assert_eq!(hex_nibble_to_seg(0xe), 0x79);
		assert_eq!(hex_nibble_to_seg(0xf), 0x71);
		assert_eq!(hex_nibble_to_seg(0x1f), 0x71);
	}

	#[test]
	fn hex_digit_char_and_unknown() {
		assert_eq!(hex_digit_to_seg('A'), hex_nibble_to_seg(0xa));
		assert_eq!(hex_digit_to_seg('f'), hex_nibble_to_seg(0xf));
		assert_eq!(hex_digit_to_seg('-'), 0);
	}

	#[test]
	fn dp_bit_is_bit7() {
		assert_eq!(hex_nibble_to_seg_with_dp(0x8, true), 0x7f | SEG_DP);
		assert!(!segment_on(hex_nibble_to_seg(0x8), SEG_DP));
		assert!(segment_on(hex_nibble_to_seg_with_dp(0x8, true), SEG_DP));
	}

	#[test]
	fn word_to_seg_digits_pads_and_truncates() {
		assert_eq!(word_to_seg_digits(0x1a, 4), vec![0x3f, 0x3f, 0x06, 0x77]);
		assert_eq!(word_to_seg_digits(0xabcde, 4), vec![0x7c, 0x39, 0x5e, 0x79]);
		assert!(word_to_seg_digits(1, 0).is_empty());
	}

	#[test]
	fn padded_unused_digits_are_blank_not_zero() {
		let addr = word_to_seg_digits_padded(0x108, 5, ADDR_DIGIT_COUNT);
		assert_eq!(addr.len(), 8);
		assert_eq!(&addr[0..3], &[0, 0, 0]);
		assert_eq!(&addr[3..], &[0x3f, 0x3f, 0x06, 0x3f, 0x7f]);
	}
}
