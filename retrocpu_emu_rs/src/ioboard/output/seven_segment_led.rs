//! IO ボードの 7セグメント LED 表示（ADDR 8 桁 + DATA 4 桁）。
//!
//! 各桁は 8bit（`[a,b,c,d,e,f,g,dp]` = bit0..7）。16 進フォントは
//! `seg_font.ts` / `seven_segment_bit_map.svg` と同じ。

mod paint;
mod panel;
mod pattern;

pub use paint::{paint_digit, paint_digit_row, SevenSegmentStyle};
pub use panel::SevenSegmentLed;
pub use pattern::{
	hex_digit_to_seg, hex_nibble_to_seg, hex_nibble_to_seg_with_dp, segment_on, word_to_seg_digits,
	word_to_seg_digits_padded, ADDR_DIGIT_COUNT, DATA_DIGIT_COUNT, DIGIT_COUNT, SEG_A, SEG_B, SEG_C,
	SEG_D, SEG_DASH, SEG_DP, SEG_E, SEG_F, SEG_G,
};
