//! LCD1602 表示エミュレータの公開モジュール。

mod panel;

pub use panel::{LcdDisplay, LcdDisplaySnapshot, LCD_COLS, LCD_ROWS};
