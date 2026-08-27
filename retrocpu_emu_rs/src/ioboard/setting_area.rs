//! IO ボード設定エリア／`mn1613.jsonc` パーサ。
//!
//! 根拠: `ioboard.mdc`「IOボード設定エリア」、TS `setting_area.ts`。
//! JSONC は `//` 行コメントを剥がしてから `serde_json` で読む。

use serde::Deserialize;
use std::path::Path;

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
	/// ADDR 7セグ桁数（1–8）。
	pub seven_seg_addr_digits: u8,
	/// DATA 7セグ桁数（1–4）。
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

/// `//` 行コメントを除去し、末尾カンマも落とす（文字列内の簡易対応付き）。
pub fn strip_jsonc_comments(text: &str) -> String {
	let mut out = String::with_capacity(text.len());
	for (i, line) in text.lines().enumerate() {
		if i > 0 {
			out.push('\n');
		}
		out.push_str(&strip_line_comment(line));
	}
	remove_trailing_commas(&out)
}

/// `,{` / `,}` / `,]` 直前の余分なカンマを除去する。
fn remove_trailing_commas(s: &str) -> String {
	let chars: Vec<char> = s.chars().collect();
	let mut out = String::with_capacity(chars.len());
	let mut i = 0;
	while i < chars.len() {
		if chars[i] == ',' {
			let mut j = i + 1;
			while j < chars.len() && chars[j].is_whitespace() {
				j += 1;
			}
			if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
				i += 1;
				continue;
			}
		}
		out.push(chars[i]);
		i += 1;
	}
	out
}

/// 1 行から `//` 以降を落とす（ダブルクォート外のみ）。
fn strip_line_comment(line: &str) -> String {
	let mut out = String::with_capacity(line.len());
	let mut in_str = false;
	let mut escape = false;
	let chars: Vec<char> = line.chars().collect();
	let mut i = 0;
	while i < chars.len() {
		let c = chars[i];
		if escape {
			out.push(c);
			escape = false;
			i += 1;
			continue;
		}
		if in_str {
			if c == '\\' {
				escape = true;
				out.push(c);
			} else if c == '"' {
				in_str = false;
				out.push(c);
			} else {
				out.push(c);
			}
			i += 1;
			continue;
		}
		if c == '"' {
			in_str = true;
			out.push(c);
			i += 1;
			continue;
		}
		if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
			break;
		}
		out.push(c);
		i += 1;
	}
	out
}

/// `"0x0108"` / `"29000"` / 数値を u32 にする。
pub fn parse_u32_flexible(s: &str) -> Result<u32, String> {
	let t = s.trim();
	if let Some(hex) = t
		.strip_prefix("0x")
		.or_else(|| t.strip_prefix("0X"))
	{
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
	let cleaned = strip_jsonc_comments(text);
	let raw: JsoncSettingsRaw =
		serde_json::from_str(&cleaned).map_err(|e| format!("jsonc parse: {e}"))?;
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

/// 設定値を 256 バイト生データへ書く。
pub fn encode_setting_area(settings: &IoBoardSettings) -> [u8; SETTING_AREA_SIZE] {
	let mut raw = [0xffu8; SETTING_AREA_SIZE];
	raw[offsets::MARK_HI] = ((SETTING_MARK >> 8) & 0xff) as u8;
	raw[offsets::MARK_LO] = (SETTING_MARK & 0xff) as u8;
	raw[offsets::CLOCK_DIV] = settings.clock_div & 0x03;
	raw[offsets::CPU_TYPE] = settings.cpu_type;
	raw[offsets::CPU_TYPE_RESET] = 0;
	raw[offsets::ADDR_STEP] = normalize_addr_step(settings.addr_step);
	let rv = settings.reset_vector;
	raw[offsets::RESET_VECTOR_0] = ((rv >> 24) & 0xff) as u8;
	raw[offsets::RESET_VECTOR_0 + 1] = ((rv >> 16) & 0xff) as u8;
	raw[offsets::RESET_VECTOR_0 + 2] = ((rv >> 8) & 0xff) as u8;
	raw[offsets::RESET_VECTOR_0 + 3] = (rv & 0xff) as u8;
	raw[offsets::SEVEN_SEG_ADDR_DIGITS] = settings.seven_seg_addr_digits;
	raw[offsets::SEVEN_SEG_DATA_DIGITS] = settings.seven_seg_data_digits;
	raw[offsets::EMULATE_PORT_HI] = ((settings.emulate_port >> 8) & 0xff) as u8;
	raw[offsets::EMULATE_PORT_HI + 1] = (settings.emulate_port & 0xff) as u8;
	raw[offsets::STEP_DELAY] = settings.step_delay;
	raw
}

/// 生データから設定を読む（マーク不正でもフィールドは読む）。
pub fn decode_setting_area(raw: &[u8]) -> IoBoardSettings {
	let mut buf = [0xffu8; SETTING_AREA_SIZE];
	let n = raw.len().min(SETTING_AREA_SIZE);
	buf[..n].copy_from_slice(&raw[..n]);
	let cpu = buf[offsets::CPU_TYPE];
	let mut s = default_settings_for_cpu(cpu);
	s.clock_div = buf[offsets::CLOCK_DIV] & 0x03;
	s.cpu_type = cpu;
	s.addr_step = normalize_addr_step(buf[offsets::ADDR_STEP]);
	s.reset_vector = ((buf[offsets::RESET_VECTOR_0] as u32) << 24)
		| ((buf[offsets::RESET_VECTOR_0 + 1] as u32) << 16)
		| ((buf[offsets::RESET_VECTOR_0 + 2] as u32) << 8)
		| (buf[offsets::RESET_VECTOR_0 + 3] as u32);
	let ad = buf[offsets::SEVEN_SEG_ADDR_DIGITS];
	if (1..=8).contains(&ad) {
		s.seven_seg_addr_digits = ad;
	}
	let dd = buf[offsets::SEVEN_SEG_DATA_DIGITS];
	if (1..=4).contains(&dd) {
		s.seven_seg_data_digits = dd;
	}
	s.emulate_port = ((buf[offsets::EMULATE_PORT_HI] as u16) << 8)
		| (buf[offsets::EMULATE_PORT_HI + 1] as u16);
	s.step_delay = buf[offsets::STEP_DELAY];
	s
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
	fn encode_decode_roundtrip() {
		let s = IoBoardSettings {
			step_delay: 60,
			emulate_port: 29000,
			..default_settings_for_cpu(cpu_type::MN1613)
		};
		let raw = encode_setting_area(&s);
		let d = decode_setting_area(&raw);
		assert_eq!(d.reset_vector, 0x0108);
		assert_eq!(d.step_delay, 60);
		assert_eq!(d.emulate_port, 29000);
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
