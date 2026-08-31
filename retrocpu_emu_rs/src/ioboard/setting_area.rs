//! IO ボード設定エリア／`mn1613.jsonc` パーサ。
//!
//! 根拠: `ioboard.mdc`「IOボード設定エリア」、TS `setting_area.ts`。
//! JSONC はライブラリ（`json5`）で読み込む。

pub mod binary;
pub mod constants;
pub mod jsonc;
pub mod settings;

pub use binary::{decode_setting_area, encode_setting_area};
pub use constants::{cpu_type, offsets, DEFAULT_EMULATE_PORT, SETTING_AREA_SIZE, SETTING_MARK};
pub use jsonc::{load_settings_jsonc, parse_settings_jsonc, parse_u32_flexible};
pub use settings::{
	align_addr_to_step, default_settings_for_cpu, normalize_addr_step, IoBoardSettings,
};
