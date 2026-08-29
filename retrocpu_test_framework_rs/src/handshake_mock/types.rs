//! ハンドシェイク定数（HandShake.mdc / retrocpu_emu_ts handshake_type.ts 相当）。

/// CPU→IO: モード設定
pub const CMD_MODE_SET: u8 = 0x10;
/// CPU→IO: 時刻取得
pub const CMD_TIME_GET: u8 = 0x11;
/// CPU→IO: タイマー設定
pub const CMD_TIMER_SET: u8 = 0x12;
/// CPU→IO: 未定義命令通知
pub const CMD_UNDEF_NOTIFY: u8 = 0x13;
/// CPU→IO: 16進キー入力取得
pub const CMD_HEX_KEY_GET: u8 = 0x14;
/// CPU→IO: PC キー入力取得
pub const CMD_PC_KEY_GET: u8 = 0x15;
/// CPU→IO: LED 表示
pub const CMD_LED_DISPLAY: u8 = 0x16;
/// CPU→IO: LCD 制御
pub const CMD_LCD_CTRL: u8 = 0x17;
/// CPU→IO: LCD 文字列
pub const CMD_LCD_TEXT: u8 = 0x18;
/// CPU→IO: BEEP
pub const CMD_BEEP: u8 = 0x19;
/// CPU→IO: ブレイク通知
pub const CMD_BREAK_NOTIFY: u8 = 0x1a;
/// CPU→IO: ステップ通知
pub const CMD_STEP_NOTIFY: u8 = 0x1b;

/// 応答 OK
pub const RESPONSE_OK: u8 = 0x00;
/// 応答 NG
pub const RESPONSE_NG: u8 = 0x01;
/// モニターモード
pub const MODE_MONITOR: u8 = 0;
/// フリーモード
pub const MODE_FREE: u8 = 1;

/// 1Ah ヘッダ長（コマンド含む）
pub const BREAK_NOTIFY_HEADER_SIZE: usize = 11;
/// 履歴 1 エントリ長（MN1613）
pub const BREAK_HISTORY_ENTRY_SIZE_MN1613: usize = 66;
/// ステップ/未定義通知フレーム長（MN1613）
pub const CPU_STATE_NOTIFY_FRAME_SIZE_MN1613: usize = 60;
/// 履歴件数上限
pub const BREAK_HISTORY_MAX_COUNT: u8 = 4;
/// 比較器スロット数
pub const ADDR_BREAK_SLOT_COUNT: u8 = 4;

/// 各コマンドの固定フレーム長（可変長 1Ah 除く）。
pub fn cpu_frame_size(cmd: u8) -> Option<usize> {
    match cmd {
        CMD_MODE_SET => Some(2),
        CMD_HEX_KEY_GET => Some(1),
        CMD_PC_KEY_GET => Some(2),
        CMD_LED_DISPLAY => Some(16),
        CMD_BEEP => Some(6),
        CMD_TIMER_SET => Some(6),
        CMD_TIME_GET => Some(1),
        CMD_BREAK_NOTIFY => Some(BREAK_NOTIFY_HEADER_SIZE),
        CMD_LCD_CTRL => Some(6),
        CMD_LCD_TEXT => Some(20),
        CMD_STEP_NOTIFY | CMD_UNDEF_NOTIFY => Some(CPU_STATE_NOTIFY_FRAME_SIZE_MN1613),
        0x1c | 0x1d | 0x1e | 0x1f => Some(1),
        _ => None,
    }
}
