//! IO↔CPU ボードリンク（in-process MVP）。
//!
//! 実機は GPIO ハンドシェイク／DMA。エミュではコマンド番号を保った RPC。
//! `cpuboard/handshake` 側は [`CpuBoardAgent`] を実装して配線する。
//! 根拠: `HandShake.mdc` / `ioboard.mdc` / TS `shared/board_link.ts`。

/// リンク／ハンドシェイク失敗。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoardLinkError {
	/// 相手が NG を返した／処理失敗。
	Ng,
	/// Agent 未接続。
	NotConnected,
	/// フレーム長・コマンド不正。
	BadFrame,
}

/// 応答コード（HandShake.mdc）。
pub mod response {
	/// OK。
	pub const OK: u8 = 0x00;
	/// NG。
	pub const NG: u8 = 0x01;
	/// NG（その他／モードエラー等）。
	pub const NG_OTHER: u8 = 0x02;
}

/// I/O → CPU コマンド番号（HandShake.mdc）。
pub mod cmd_io_to_cpu {
	/// 実行指示。
	pub const EXEC: u8 = 0x82;
	/// メモリ読み出し。
	pub const MEM_READ: u8 = 0x83;
	/// メモリ書き込み。
	pub const MEM_WRITE: u8 = 0x84;
}

/// CPU ボードが実装する IO→CPU サービス（DMA + ハンドシェイク 82/83/84）。
///
/// アドレスはいずれも **バイトアドレス**（HandShake.mdc の addr32）。
/// MN1613 のワードアドレスは呼び出し側で `word << 1` する。
pub trait CpuBoardAgent {
	/// DMA で RAM へ書く（書き込み専用。HALT/RESET 時のみ想定）。
	fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError>;

	/// ハンドシェイク `83h` 相当のメモリ読み。
	fn hshk_mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError>;

	/// ハンドシェイク `84h` 相当のメモリ書き。
	fn hshk_mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError>;

	/// ハンドシェイク `82h` 相当の実行開始（`byte_addr` はバイト。MN1613 は偶数）。
	fn hshk_exec(&mut self, byte_addr: u32) -> Result<(), BoardLinkError>;

	/// HALT 要求（true=停止 / false=再開）。
	fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError>;

	/// RST パルス。`reset_vector_word` は IO:0 相当のワードアドレス（任意）。
	fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError>;

	/// 現在 HALT 相当か（表示用）。
	fn is_halted(&self) -> bool;
}

/// IO ボード前面パネルが CPU／設定へ頼む操作（コンソール用）。
///
/// メモリ系アドレスは **バイトアドレス**。
pub trait PanelHost {
	/// メモリ読み（ハンドシェイク `83h`）。
	fn mem_read(&mut self, addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError>;

	/// メモリ書き（ハンドシェイク `84h`）。
	fn mem_write(&mut self, addr: u32, data: &[u8]) -> Result<(), BoardLinkError>;

	/// 実行指示（ハンドシェイク `82h`）。
	fn exec(&mut self, addr: u32) -> Result<(), BoardLinkError>;

	/// 実行再開。
	fn start_run(&mut self) -> Result<(), BoardLinkError>;

	/// HALT 要求。
	fn request_halt(&mut self) -> Result<(), BoardLinkError>;

	/// F7 RST: HALT → ブートモニタ DMA → CPU RST。
	fn reset_and_reload_monitor(&mut self) -> Result<(), BoardLinkError>;

	/// 現在 HALT 相当か。
	fn cpu_halted(&self) -> bool;

	/// 設定エリア（00h–FFh）1 バイト読み。
	fn read_setting_byte(&self, byte_addr: u8) -> u8;

	/// 設定エリア（00h–FFh）1 バイト書き。
	fn write_setting_byte(&mut self, byte_addr: u8, value: u8);
}

/// IO が `CpuBoardAgent` を即時呼び出す薄い橋（[`crate::cpuboard::mn1613::handshake::FrameLink`] とは別）。
pub struct AgentBridge<C: CpuBoardAgent> {
	/// CPU ボード側エージェント。
	pub cpu: C,
}

impl<C: CpuBoardAgent> AgentBridge<C> {
	/// CPU Agent を包む。
	///
	/// # Arguments
	/// - `cpu`: CPU エージェント
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(cpu: C) -> Self {
		Self { cpu }
	}

	/// DMA 書き込み。
	///
	/// # Arguments
	/// - `byte_addr`: バイトアドレス
	/// - `data`: データ列
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.cpu.dma_write_bytes(byte_addr, data)
	}

	/// `83h` メモリ読み。
	///
	/// # Arguments
	/// - `byte_addr`: バイトアドレス
	/// - `len`: 長さ
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		self.cpu.hshk_mem_read(byte_addr, len)
	}

	/// `84h` メモリ書き。
	///
	/// # Arguments
	/// - `byte_addr`: バイトアドレス
	/// - `data`: データ列
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.cpu.hshk_mem_write(byte_addr, data)
	}

	/// `82h` 実行。
	///
	/// # Arguments
	/// - `byte_addr`: バイトアドレス
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn exec(&mut self, byte_addr: u32) -> Result<(), BoardLinkError> {
		self.cpu.hshk_exec(byte_addr)
	}

	/// HALT 設定。
	///
	/// # Arguments
	/// - `halt`: 関数に渡す値
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
		self.cpu.set_halt(halt)
	}

	/// RST パルス。
	///
	/// # Arguments
	/// - `reset_vector_word`: 関数に渡す値
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
		self.cpu.pulse_reset(reset_vector_word)
	}

	/// HALT 状態。
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_halted(&self) -> bool {
		self.cpu.is_halted()
	}
}
