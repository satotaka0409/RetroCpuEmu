//! IO ボードの砲弾型 LED（0–F の 16 本）。
//!
//! 点灯ビットはハンドシェイク `16h` の `bulletLed0_7` / `bulletLed8_F` と同じ。
//! B=UNDEF、C=RUN、D=HALT、E=ADDR、F=DATA（`ioboard.mdc`）。

mod color;
mod paint;
mod panel;

pub use color::{default_color_for_index, LedColor, LedTone};
pub use paint::{paint_bullet, paint_bullet_allocated, BulletLedStyle};
pub use panel::{
	BulletLed, FocusLed, BULLET_COUNT, LED_ADDR, LED_DATA, LED_HALT, LED_RUN, LED_UNDEF,
	USER_LED_LAST,
};
