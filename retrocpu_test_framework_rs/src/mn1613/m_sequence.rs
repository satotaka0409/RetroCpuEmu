use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::FrameworkError;

pub const MEM_MSEQ_TAP: u16 = 0xb400;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MSequenceMemory {
    pub buffer: Vec<u8>,
    pub seed: u16,
}

pub fn mem_mseq_seed_from_time() -> u16 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mixed = (now.as_nanos() ^ ((now.as_millis()) << 20) ^ (now.as_millis() >> 4)) & 0xffff;
    let seed = mixed as u16;
    if seed == 0 {
        1
    } else {
        seed
    }
}

pub fn mseq_step(seed: u16) -> u16 {
    let mut x = if seed == 0 { 1 } else { seed };
    let lsb = x & 1;
    x >>= 1;
    if lsb != 0 {
        x ^= MEM_MSEQ_TAP;
    }
    x
}

fn normalize_seed(seed: u16) -> u16 {
    if seed == 0 {
        1
    } else {
        seed
    }
}

pub fn fill_memory_m_sequence(buf: &mut [u8], seed: Option<u16>) -> Result<u16, FrameworkError> {
    if (buf.len() & 1) != 0 {
        return Err(FrameworkError::invalid_argument(format!(
            "buffer length must be even (got {})",
            buf.len()
        )));
    }

    let start = normalize_seed(seed.unwrap_or_else(mem_mseq_seed_from_time));
    let mut x = start;

    for word_idx in 0..(buf.len() / 2) {
        x = mseq_step(x);
        let off = word_idx * 2;
        buf[off] = (x >> 8) as u8;
        buf[off + 1] = (x & 0xff) as u8;
    }

    Ok(start)
}

pub fn create_m_sequence_memory(
    byte_length: usize,
    seed: Option<u16>,
) -> Result<MSequenceMemory, FrameworkError> {
    if (byte_length & 1) != 0 {
        return Err(FrameworkError::invalid_argument(format!(
            "byte_length must be even (got {})",
            byte_length
        )));
    }

    let mut buffer = vec![0_u8; byte_length];
    let used_seed = fill_memory_m_sequence(&mut buffer, seed)?;
    Ok(MSequenceMemory {
        buffer,
        seed: used_seed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_matches_known_values() {
        let mut x = 1_u16;
        x = mseq_step(x);
        assert_eq!(x, 0xb400);
        x = mseq_step(x);
        assert_eq!(x, 0x5a00);
    }

    #[test]
    fn fill_writes_big_endian_words() {
        let mut buf = vec![0_u8; 4];
        let seed = fill_memory_m_sequence(&mut buf, Some(1)).expect("fill should work");
        assert_eq!(seed, 1);
        assert_eq!(buf, vec![0xb4, 0x00, 0x5a, 0x00]);
    }

    #[test]
    fn odd_length_is_error() {
        let mut buf = vec![0_u8; 3];
        let err = fill_memory_m_sequence(&mut buf, Some(1)).unwrap_err();
        assert!(matches!(err, FrameworkError::InvalidArgument(_)));
    }
}
