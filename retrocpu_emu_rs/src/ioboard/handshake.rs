//! IO ボード側ハンドシェイク（in-process MVP）。
//!
//! ビットバンはせず、フレームを組んで [`CpuBoardAgent`] へ即時ディスパッチする。
//! 線上レイアウトは `HandShake.mdc`（addr32 BE / count32 BE）に合わせる。
//! CPU→IO は `17h/18h` の LCD を処理し、未知コマンドは MVP で OK を返す。

pub mod codec;
pub mod dispatcher;
pub mod lcd;

pub use codec::{
	encode_exec, encode_mem_read, encode_mem_write, read_u32_be, u32_be, EXEC_WIRE_LEN,
	MEM_RW_WIRE_HEADER_LEN,
};
pub use dispatcher::{
	dispatch_io_to_cpu, exec, handle_cpu_to_io, handle_cpu_to_io_with_logger, mem_read, mem_write,
	HandshakeDispatcher, IoHandshakePeer, LcdLogEvent, PanelEventLogger,
};
pub use lcd::{
	dispatch_lcd_frame, handle_lcd_control_frame, handle_lcd_text_frame, CMD_LCD_CTRL, CMD_LCD_TEXT,
	LCD_CTRL_CLEAR, LCD_CTRL_DISPLAY, LCD_CTRL_HOME, LCD_CTRL_SET_CURSOR,
};
