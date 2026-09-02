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

/// 光センサー生値（RGBC）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LightRawData {
    /// クリア
    pub clear: u16,
    /// 赤
    pub red: u16,
    /// 緑
    pub green: u16,
    /// 青
    pub blue: u16,
}

/// 距離センサー生値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistanceRawData {
    /// 距離 mm
    pub distance_mm: u16,
    /// range status（下位5bit有効）
    pub range_status: u8,
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

/// 1Ah ブレイク通知の記録（TS `lastBreakNotify` 相当）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakNotifyInfo {
    /// 0=命令 / 1=MEM / 2=IO
    pub kind: u8,
    /// 比較器スロット 0–3
    pub slot: u8,
    /// 80h 設定の flags エコー
    pub flags: u8,
    /// n_stop エコー
    pub break_count: u8,
    /// 有効履歴件数
    pub history_count: u8,
    /// 監視アドレス（32bit）
    pub addr: u32,
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
    /// RTC 生値 7バイト
    pub rtc_raw: [u8; 7],
    /// 温度生値
    pub temp_raw: u16,
    /// 光センサー生値
    pub light_raw: LightRawData,
    /// 距離センサー生値
    pub distance_raw: DistanceRawData,
    /// 直近 1Ah ブレイク通知。未通知なら None。
    pub last_break_notify: Option<BreakNotifyInfo>,
    /// 13h 未定義命令 LED（UNDEF 砲弾）
    pub undef_led: bool,
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
            rtc_raw: [0; 7],
            temp_raw: 0,
            light_raw: LightRawData {
                clear: 0,
                red: 0,
                green: 0,
                blue: 0,
            },
            distance_raw: DistanceRawData {
                distance_mm: 0,
                range_status: 0,
            },
            last_break_notify: None,
            undef_led: false,
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
