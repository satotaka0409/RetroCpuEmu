//! 例アプリ共通の起動ヘルパ（WSL / Linux 向け）。

/// WSL の WSLg では Wayland が Broken pipe になりやすいので X11 を使う。
///
/// 必要パッケージ（X11 経路）:
/// `sudo apt install libxkbcommon-x11-0`
pub fn prefer_x11_on_linux() {
	#[cfg(target_os = "linux")]
	{
		// Wayland ソケットが残っていると winit がそちらへ寄ることがあるので外す。
		unsafe {
			std::env::remove_var("WAYLAND_DISPLAY");
			std::env::remove_var("WAYLAND_SOCKET");
			if std::env::var_os("WINIT_UNIX_BACKEND").is_none() {
				std::env::set_var("WINIT_UNIX_BACKEND", "x11");
			}
			if std::env::var_os("DISPLAY").is_none() {
				std::env::set_var("DISPLAY", ":0");
			}
		}
		warn_if_missing_xkbcommon_x11();
	}
}

/// `libxkbcommon-x11` が無いと X11 起動でパニックするので、先に分かりやすく出す。
#[cfg(target_os = "linux")]
fn warn_if_missing_xkbcommon_x11() {
	let path_ok = [
		"/usr/lib/x86_64-linux-gnu/libxkbcommon-x11.so.0",
		"/lib/x86_64-linux-gnu/libxkbcommon-x11.so.0",
		"/usr/lib/libxkbcommon-x11.so.0",
	]
	.iter()
	.any(|p| std::path::Path::new(p).exists());
	if path_ok {
		return;
	}
	let ld_ok = std::process::Command::new("sh")
		.args([
			"-c",
			"ldconfig -p 2>/dev/null | grep -q libxkbcommon-x11.so",
		])
		.status()
		.map(|s| s.success())
		.unwrap_or(false);
	if ld_ok {
		return;
	}
	eprintln!(
		"警告: libxkbcommon-x11 が見つかりません。WSL で X11 表示するには次を実行してください:\n  sudo apt install libxkbcommon-x11-0\n"
	);
}
