//! モニター操作（メモリ読書き／実行／アドレス制御）。

pub mod io_console;
pub mod io_monitor;

pub use io_console::{ConsoleFnKey, ConsoleFocus, ConsoleMode, IoConsole, IoConsoleState};
pub use io_monitor::IoMonitor;
