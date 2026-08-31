//! コンソール（前面パネル ADDR/DATA／ファンクションキー）。

pub mod io_console;

pub use io_console::{
	ConsoleFocus, ConsoleFnKey, ConsoleMode, IoConsole, IoConsoleState,
};
