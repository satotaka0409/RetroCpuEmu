use crate::error::FrameworkError;

fn parse_hex_byte(s: &str) -> Result<u8, FrameworkError> {
    u8::from_str_radix(s, 16)
        .map_err(|_| FrameworkError::invalid_argument(format!("invalid hex byte: {s}")))
}

pub fn load_intel_hex(hex_text: &str, memory: &mut [u8]) -> Result<(), FrameworkError> {
    let mut upper_addr: u32 = 0;

    for (line_no, raw) in hex_text.replace("\r\n", "\n").split('\n').enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with(':') {
            return Err(FrameworkError::invalid_argument(format!(
                "line {}: invalid record start",
                line_no + 1
            )));
        }
        if line.len() < 11 || (line.len() & 1) == 0 {
            return Err(FrameworkError::invalid_argument(format!(
                "line {}: invalid record length",
                line_no + 1
            )));
        }

        let body = &line[1..];
        let byte_count = parse_hex_byte(&body[0..2])? as usize;
        let addr_hi = parse_hex_byte(&body[2..4])? as u16;
        let addr_lo = parse_hex_byte(&body[4..6])? as u16;
        let record_type = parse_hex_byte(&body[6..8])?;

        let expected_chars = 2 + 4 + 2 + byte_count * 2 + 2;
        if body.len() != expected_chars {
            return Err(FrameworkError::invalid_argument(format!(
                "line {}: byte count mismatch",
                line_no + 1
            )));
        }

        let mut data = Vec::with_capacity(byte_count);
        let mut sum: u32 = byte_count as u32 + addr_hi as u32 + addr_lo as u32 + record_type as u32;

        let mut off = 8;
        for _ in 0..byte_count {
            let b = parse_hex_byte(&body[off..off + 2])?;
            data.push(b);
            sum = sum.wrapping_add(b as u32);
            off += 2;
        }

        let checksum = parse_hex_byte(&body[off..off + 2])?;
        let calc = (!sum as u8).wrapping_add(1);
        if calc != checksum {
            return Err(FrameworkError::invalid_argument(format!(
                "line {}: checksum mismatch",
                line_no + 1
            )));
        }

        let addr16 = ((addr_hi << 8) | addr_lo) as u32;
        match record_type {
            0x00 => {
                let base = upper_addr.wrapping_add(addr16);
                for (i, b) in data.iter().enumerate() {
                    let a = base.wrapping_add(i as u32) as usize;
                    if a >= memory.len() {
                        return Err(FrameworkError::invalid_argument(format!(
                            "line {}: memory write out of range 0x{:x}",
                            line_no + 1,
                            a
                        )));
                    }
                    memory[a] = *b;
                }
            }
            0x01 => break,
            0x02 => {
                if data.len() != 2 {
                    return Err(FrameworkError::invalid_argument(format!(
                        "line {}: invalid type 02 length",
                        line_no + 1
                    )));
                }
                let segment = ((data[0] as u32) << 8) | (data[1] as u32);
                upper_addr = segment << 4;
            }
            0x04 => {
                if data.len() != 2 {
                    return Err(FrameworkError::invalid_argument(format!(
                        "line {}: invalid type 04 length",
                        line_no + 1
                    )));
                }
                let upper = ((data[0] as u32) << 8) | (data[1] as u32);
                upper_addr = upper << 16;
            }
            _ => {}
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_data_record() {
        let mut mem = [0_u8; 0x200];
        let hex = ":0401000002011122C5\n:00000001FF\n";
        load_intel_hex(hex, &mut mem).expect("load should work");
        assert_eq!(mem[0x100], 0x02);
        assert_eq!(mem[0x101], 0x01);
        assert_eq!(mem[0x102], 0x11);
        assert_eq!(mem[0x103], 0x22);
    }
}
