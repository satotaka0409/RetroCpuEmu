//! CPU→IO コマンド受信長とディスパッチ（HandShake.mdc）。

use super::mock_state::{read_u16_be, IoBoardMockState, LedDisplayData};
use super::types::*;

/// 可変長 1Ah を含む残余バイト数。
pub fn cpu_to_io_remaining_size(frame: &[u8], entry_size: usize) -> usize {
    if frame.is_empty() {
        return 0;
    }
    let cmd = frame[0];
    if cmd != CMD_BREAK_NOTIFY {
        let total = cpu_frame_size(cmd).unwrap_or(1);
        return total.saturating_sub(frame.len());
    }
    if frame.len() < 3 {
        return BREAK_NOTIFY_HEADER_SIZE.saturating_sub(frame.len());
    }
    let history_count = frame[2];
    if history_count > BREAK_HISTORY_MAX_COUNT {
        return BREAK_NOTIFY_HEADER_SIZE.saturating_sub(frame.len());
    }
    let total = BREAK_NOTIFY_HEADER_SIZE + (history_count as usize) * entry_size;
    total.saturating_sub(frame.len())
}

/// CPU→IO フレームを処理し、IO→CPU 応答バイト列を返す。
pub fn dispatch_cpu_to_io(state: &mut IoBoardMockState, frame: &[u8]) -> Vec<u8> {
    if frame.is_empty() {
        return vec![RESPONSE_NG];
    }
    let cmd = frame[0];
    if let Some(expected) = cpu_frame_size(cmd) {
        if frame.len() < expected && cmd != CMD_BREAK_NOTIFY {
            return vec![RESPONSE_NG];
        }
    }
    match cmd {
        CMD_MODE_SET => {
            if frame.len() < 2 {
                return vec![RESPONSE_NG];
            }
            vec![super::mock_state::mode_set(state, frame[1])]
        }
        CMD_HEX_KEY_GET => {
            if state.mode != MODE_FREE {
                let mut out = vec![0u8; 8];
                out.push(RESPONSE_NG);
                return out;
            }
            let mut out = state.hex_keys.to_vec();
            out.push(RESPONSE_OK);
            out
        }
        CMD_PC_KEY_GET => {
            vec![state.pc_key.0, state.pc_key.1, RESPONSE_OK]
        }
        CMD_LED_DISPLAY => {
            if state.mode != MODE_FREE {
                return vec![RESPONSE_NG];
            }
            if frame.len() < 16 {
                return vec![RESPONSE_NG];
            }
            let mut seven = [0u8; 12];
            seven.copy_from_slice(&frame[2..14]);
            state.led = Some(LedDisplayData {
                seven_seg: seven,
                bullet_led_0_7: frame[14],
                bullet_led_8_f: frame[15],
            });
            vec![RESPONSE_OK]
        }
        CMD_BEEP => {
            if frame.len() < 6 {
                return vec![RESPONSE_NG];
            }
            state.last_beep = Some(super::mock_state::BeepParams {
                frequency_hz: read_u16_be(frame, 1),
                duration_ms: read_u16_be(frame, 3),
            });
            vec![RESPONSE_OK]
        }
        CMD_TIMER_SET => {
            if frame.len() < 6 {
                return vec![RESPONSE_NG];
            }
            if frame[1] != 0 {
                return vec![RESPONSE_NG];
            }
            state.last_timer = Some(super::mock_state::TimerParams {
                timer_no: frame[1],
                period_ms: read_u16_be(frame, 2),
                count: read_u16_be(frame, 4),
            });
            vec![RESPONSE_OK]
        }
        CMD_TIME_GET => {
            let mut out = state.timestamp.to_vec();
            out.push(RESPONSE_OK);
            out
        }
        CMD_BREAK_NOTIFY => {
            if frame.len() < BREAK_NOTIFY_HEADER_SIZE {
                return vec![RESPONSE_NG];
            }
            let slot = frame[1];
            if slot >= ADDR_BREAK_SLOT_COUNT {
                return vec![RESPONSE_NG];
            }
            vec![RESPONSE_OK]
        }
        CMD_LCD_CTRL | CMD_LCD_TEXT | CMD_STEP_NOTIFY | CMD_UNDEF_NOTIFY => vec![RESPONSE_OK],
        0x1c => {
            let mut out = state.rtc_raw.to_vec();
            out.push(RESPONSE_OK);
            out
        }
        0x1d => vec![
            ((state.temp_raw >> 8) & 0xff) as u8,
            (state.temp_raw & 0xff) as u8,
            RESPONSE_OK,
        ],
        0x1e => vec![
            ((state.light_raw.clear >> 8) & 0xff) as u8,
            (state.light_raw.clear & 0xff) as u8,
            ((state.light_raw.red >> 8) & 0xff) as u8,
            (state.light_raw.red & 0xff) as u8,
            ((state.light_raw.green >> 8) & 0xff) as u8,
            (state.light_raw.green & 0xff) as u8,
            ((state.light_raw.blue >> 8) & 0xff) as u8,
            (state.light_raw.blue & 0xff) as u8,
            RESPONSE_OK,
        ],
        0x1f => vec![
            ((state.distance_raw.distance_mm >> 8) & 0xff) as u8,
            (state.distance_raw.distance_mm & 0xff) as u8,
            state.distance_raw.range_status & 0x1f,
            RESPONSE_OK,
        ],
        _ => vec![RESPONSE_NG],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_set_ok() {
        let mut state = IoBoardMockState::new();
        let resp = dispatch_cpu_to_io(&mut state, &[CMD_MODE_SET, MODE_FREE]);
        assert_eq!(resp, vec![RESPONSE_OK]);
        assert_eq!(state.mode, MODE_FREE);
    }

    #[test]
    fn time_get_returns_timestamp() {
        let mut state = IoBoardMockState::new();
        state.set_timestamp_u64(0x0102_0304_0506_0708);
        let resp = dispatch_cpu_to_io(&mut state, &[CMD_TIME_GET]);
        assert_eq!(resp.len(), 9);
        assert_eq!(resp[8], RESPONSE_OK);
        assert_eq!(resp[0], 0x01);
        assert_eq!(resp[7], 0x08);
    }
}
