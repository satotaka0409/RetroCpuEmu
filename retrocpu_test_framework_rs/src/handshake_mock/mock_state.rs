//! IO ボード側 CPU→IO コマンド用状態（テスト mock）。

use super::types::{MODE_MONITOR, RESPONSE_OK};

/// BEEP パラメータ記録。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeepParams {
    /// 周波数 Hz（0=停止）
    pub frequency_hz: u16,
    /// 長さ ms（0=無限）
    pub duration_ms: u16,
}

/// タイマー設定記録。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimerParams {
    /// タイマー番号（0 のみ）
    pub timer_no: u8,
    /// 周期 ms
    pub period_ms: u16,
    /// 回数（0=無限）
    pub count: u16,
}

/// LED 表示データ。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedDisplayData {
    /// 7seg 12 桁
    pub seven_seg: [u8; 12],
    /// 砲弾 0–7
    pub bullet_led_0_7: u8,
    /// 砲弾 8–F
    pub bullet_led_8_f: u8,
}

/// IO ボード mock 状態。
#[derive(Debug, Clone)]
pub struct IoBoardMockState {
    /// 0=モニター / 1=フリー
    pub mode: u8,
    /// LED 表示
    pub led: Option<LedDisplayData>,
    /// 16 進キー列 0–7
    pub hex_keys: [u8; 8],
    /// PC キー
    pub pc_key: (u8, u8),
    /// 直近 BEEP
    pub last_beep: Option<BeepParams>,
    /// 直近タイマー設定
    pub last_timer: Option<TimerParams>,
    /// 64bit タイマー（先頭=時刻7）
    pub timestamp: [u8; 8],
}

impl IoBoardMockState {
    /// モニターモード・入力なしの初期状態。
    pub fn new() -> Self {
        Self {
            mode: MODE_MONITOR,
            led: None,
            hex_keys: [0; 8],
            pc_key: (0, 0),
            last_beep: None,
            last_timer: None,
            timestamp: [0; 8],
        }
    }

    /// 時刻 64bit を BE で設定する。
    pub fn set_timestamp_u64(&mut self, value: u64) {
        for i in 0..8 {
            self.timestamp[i] = ((value >> (56 - i * 8)) & 0xff) as u8;
        }
    }
}

/// 16bit BE 読み取り。
pub fn read_u16_be(buf: &[u8], ofs: usize) -> u16 {
    (((buf[ofs] as u16) << 8) | (buf[ofs + 1] as u16)) & 0xffff
}

/// 既定ハンドラ相当の簡易応答コード。
pub fn mode_set(state: &mut IoBoardMockState, mode: u8) -> u8 {
    if mode != MODE_MONITOR && mode != super::types::MODE_FREE {
        return super::types::RESPONSE_NG;
    }
    state.mode = mode;
    if mode != super::types::MODE_FREE {
        state.hex_keys = [0; 8];
    }
    RESPONSE_OK
}
