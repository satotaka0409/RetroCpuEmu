//! JSONC 読み込みとパース。

use json5;
use serde::Deserialize;
use std::path::Path;

use super::constants::cpu_type;
use super::settings::{default_settings_for_cpu, normalize_addr_step, IoBoardSettings};

/// `"0x0108"` / `"29000"` / 数値を u32 にする。
pub fn parse_u32_flexible(s: &str) -> Result<u32, String> {
	let t = s.trim();
	if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
		u32::from_str_radix(hex, 16).map_err(|e| e.to_string())
	} else {
		t.parse::<u32>().map_err(|e| e.to_string())
	}
}

#[derive(Debug, Deserialize)]
struct JsoncSettingsRaw {
	#[serde(default)]
	clock: Option<String>,
	#[serde(default)]
	cpu: Option<String>,
	#[serde(default)]
	address_addcount: Option<String>,
	#[serde(default)]
	reset_vector: Option<String>,
	/// jsonc の typo キー名をそのまま受け取る。
	#[serde(default, rename = "sevenseg_adddress_digit")]
	sevenseg_address_digit: Option<String>,
	#[serde(default)]
	sevenseg_data_digit: Option<String>,
	#[serde(default)]
	emulate_port: Option<String>,
	#[serde(default)]
	step_delay: Option<String>,
	#[serde(default)]
	boot: Option<String>,
}

/// JSONC テキストから設定を読む。
pub fn parse_settings_jsonc(text: &str) -> Result<IoBoardSettings, String> {
	let raw: JsoncSettingsRaw = json5::from_str(text).map_err(|e| format!("jsonc parse: {e}"))?;
	let cpu = raw
		.cpu
		.as_deref()
		.map(parse_u32_flexible)
		.transpose()?
		.unwrap_or(cpu_type::MN1613 as u32) as u8;
	let mut s = default_settings_for_cpu(cpu);
	if let Some(v) = raw.clock.as_deref() {
		s.clock_div = (parse_u32_flexible(v)? as u8) & 0x03;
	}
	if let Some(v) = raw.address_addcount.as_deref() {
		s.addr_step = normalize_addr_step(parse_u32_flexible(v)? as u8);
	}
	if let Some(v) = raw.reset_vector.as_deref() {
		s.reset_vector = parse_u32_flexible(v)?;
	}
	if let Some(v) = raw.sevenseg_address_digit.as_deref() {
		let d = parse_u32_flexible(v)? as u8;
		if (1..=8).contains(&d) {
			s.seven_seg_addr_digits = d;
		}
	}
	if let Some(v) = raw.sevenseg_data_digit.as_deref() {
		let d = parse_u32_flexible(v)? as u8;
		if (1..=4).contains(&d) {
			s.seven_seg_data_digits = d;
		}
	}
	if let Some(v) = raw.emulate_port.as_deref() {
		s.emulate_port = parse_u32_flexible(v)? as u16;
	}
	if let Some(v) = raw.step_delay.as_deref() {
		s.step_delay = parse_u32_flexible(v)? as u8;
	}
	s.boot = raw.boot.filter(|b| !b.is_empty());
	Ok(s)
}

/// ファイルから JSONC 設定を読む。
pub fn load_settings_jsonc(path: impl AsRef<Path>) -> Result<IoBoardSettings, String> {
	let text = std::fs::read_to_string(path.as_ref()).map_err(|e| e.to_string())?;
	parse_settings_jsonc(&text)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_mn1613_jsonc_like() {
		let text = r#"{
	"clock": "0", // comment
	"cpu": "1",
	"address_addcount": "1",
	"reset_vector": "0x0108",
	"sevenseg_adddress_digit": "5",
	"sevenseg_data_digit": "4",
	"emulate_port": "29000",
	"step_delay": "60",
	"boot": "mn1613_mon.ihx",
}"#;
		let s = parse_settings_jsonc(text).expect("parse");
		assert_eq!(s.reset_vector, 0x0108);
		assert_eq!(s.seven_seg_addr_digits, 5);
		assert_eq!(s.seven_seg_data_digits, 4);
		assert_eq!(s.step_delay, 60);
		assert_eq!(s.emulate_port, 29000);
		assert_eq!(s.boot.as_deref(), Some("mn1613_mon.ihx"));
	}

	#[test]
	fn load_repo_mn1613_jsonc() {
		let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("mn1613.jsonc");
		let s = load_settings_jsonc(&path).expect("load mn1613.jsonc");
		assert_eq!(s.reset_vector, 0x0108);
		assert_eq!(s.seven_seg_addr_digits, 5);
		assert_eq!(s.step_delay, 60);
		assert_eq!(s.emulate_port, 29000);
	}
}
