//! 設定エリア生データのエンコード/デコード。 

use super::constants::{offsets, SETTING_AREA_SIZE, SETTING_MARK};
use super::settings::{default_settings_for_cpu, normalize_addr_step, IoBoardSettings};

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
	use crate::ioboard::setting_area::{cpu_type, default_settings_for_cpu};

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
}
