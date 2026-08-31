//! テスト用 IO モック（MN1613 ポート 0x20–0x25 + handshake）。
//!
//! 根拠: `retrocpu_test_framework_ts/src/handshake_mock.ts` / emulater_code_test.mdc

mod cpu_to_io;
mod io_control_sync;
mod mock_state;
mod types;

use std::sync::{Arc, Mutex};

use retrocpu_emu_rs::cpuboard::cpu_core::mn1613::{IoCallbacks, NullIo};
use retrocpu_emu_rs::cpuboard::handshake::mn1613::board_link::{FrameLink, HandshakeTransport};
use retrocpu_emu_rs::cpuboard::handshake::mn1613::wires::{
    HandshakeWires, HSHK_CTRL_IN_DACK, HSHK_CTRL_OUT_DENA, HSHK_CTRL_OUT_REQ, HSHK_IN_CTRL_IN_REQ,
    IO_PORT_HSHK_IN_CTRL, IO_PORT_HSHK_OUT_CTRL, IO_PORT_HSHK_OUT_DATA,
};

pub use mock_state::{BeepParams, IoBoardMockState, LedDisplayData, TimerParams};
pub use types::{CMD_MODE_SET, MODE_FREE, MODE_MONITOR, RESPONSE_OK};

use crate::error::FrameworkError;
use crate::framework::mn1613::types::PortMockState;
use crate::json_value::CodeTestIoMockEntry;

use cpu_to_io::{cpu_to_io_remaining_size, dispatch_cpu_to_io};
use io_control_sync::IoControlSync;
use types::BREAK_HISTORY_ENTRY_SIZE_MN1613;

const DEFAULT_RD: u16 = 0xffff;
const HSHK_PORT_MIN: u16 = 0x20;
const HSHK_PORT_MAX: u16 = 0x25;
const DEFAULT_HANDSHAKE_TIMEOUT_MS: u64 = 5000;

/// 1階 IO ボード handshake モック（同期実装）。
#[derive(Debug)]
pub struct IoBoardHandshakeMock {
    pub wires: Arc<Mutex<HandshakeWires>>,
    pub link: Arc<Mutex<FrameLink>>,
    pub state: Arc<Mutex<IoBoardMockState>>,
    timeout_ms: u64,
}

impl IoBoardHandshakeMock {
    /// 空の handshake モックを作る。
    pub fn new() -> Self {
        Self::with_timeout(DEFAULT_HANDSHAKE_TIMEOUT_MS)
    }

    /// タイムアウト ms を指定して作る。
    pub fn with_timeout(timeout_ms: u64) -> Self {
        Self {
            wires: Arc::new(Mutex::new(HandshakeWires::new())),
            link: Arc::new(Mutex::new(FrameLink::new())),
            state: Arc::new(Mutex::new(IoBoardMockState::new())),
            timeout_ms,
        }
    }

    /// CPU→IO フレームを取り出す（FrameLink 互換）。
    pub fn take_cpu_to_io_frame(&self) -> Option<Vec<u8>> {
        self.link.lock().expect("link lock").pop_cpu_to_io()
    }

    /// IO→CPU フレームを積む（FrameLink 互換）。
    pub fn push_io_to_cpu(&self, frame: &[u8]) {
        self.link.lock().expect("link lock").push_io_to_cpu(frame);
    }

    /// 線状態とリンクをリセットする。
    pub fn reset(&self) {
        self.wires.lock().expect("wires lock").reset();
        self.link.lock().expect("link lock").clear();
        *self.state.lock().expect("state lock") = IoBoardMockState::new();
    }

    /// 受信フレームをディスパッチして応答バイト列を返す（線シミュレーションなし）。
    pub fn dispatch_cpu_to_io(&self, frame: &[u8]) -> Vec<u8> {
        dispatch_cpu_to_io(&mut self.state.lock().expect("state lock"), frame)
    }

    /// CPU→IO を 1 トランザクション処理（受信→dispatch→応答送信）。
    pub fn handle_one_request<P>(&self, poll: &mut P) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        let io = IoControlSync::new(Arc::clone(&self.wires), self.timeout_ms);
        let entry_size = BREAK_HISTORY_ENTRY_SIZE_MN1613;
        let frame = io
            .receive_framed_adaptive(poll, |so_far| cpu_to_io_remaining_size(so_far, entry_size))?;
        let response = self.dispatch_cpu_to_io(&frame);
        if !response.is_empty() {
            io.send(poll, &response, false)?;
        }
        Ok(response)
    }

    /// 64bit タイマー応答（11h）を設定する。
    pub fn set_timestamp_u64(&self, value: u64) {
        self.state
            .lock()
            .expect("state lock")
            .set_timestamp_u64(value);
    }
}

impl Default for IoBoardHandshakeMock {
    fn default() -> Self {
        Self::new()
    }
}

/// ioMock エントリにフレームワーク既定を足す（handshake は inert タイマー相当の timeout のみ）。
pub fn with_framework_io_mock_defaults(
    entries: Vec<CodeTestIoMockEntry>,
) -> Vec<CodeTestIoMockEntry> {
    entries
}

/// 設定 JSON の ioMock から RD/WT モックを組み立てる。
#[derive(Debug)]
pub struct CodeTestIoMock {
    pub handshake: Option<Arc<IoBoardHandshakeMock>>,
    ports: Arc<Mutex<PortMockState>>,
}

impl CodeTestIoMock {
    /// ioMock 設定から作る。
    pub fn new(entries: &[CodeTestIoMockEntry]) -> Result<Arc<Self>, FrameworkError> {
        if entries.is_empty() {
            return Err(FrameworkError::invalid_argument("ioMock: empty entry list"));
        }
        let mut ports = PortMockState::default();
        let mut handshake: Option<Arc<IoBoardHandshakeMock>> = None;
        for e in entries {
            match e {
                CodeTestIoMockEntry::Handshake => {
                    if handshake.is_some() {
                        return Err(FrameworkError::invalid_argument(
                            "ioMock: duplicate handshake entry",
                        ));
                    }
                    handshake = Some(Arc::new(IoBoardHandshakeMock::new()));
                }
                CodeTestIoMockEntry::PortRead { port, value } => {
                    ports.reads.insert(*port, *value);
                }
            }
        }
        Ok(Arc::new(Self {
            handshake,
            ports: Arc::new(Mutex::new(ports)),
        }))
    }

    /// 書込ログ付きポート状態を返す。
    pub fn port_state(&self) -> Arc<Mutex<PortMockState>> {
        Arc::clone(&self.ports)
    }

    /// MN1613 IO コールバックを作る。
    pub fn build_io_callbacks(self: &Arc<Self>) -> TestIoCallbacks {
        TestIoCallbacks {
            inner: NullIo,
            ports: Arc::clone(&self.ports),
            handshake: self.handshake.clone(),
        }
    }
}

/// テスト用 IO コールバック。port エントリで RD を差し替える。
#[derive(Debug)]
pub struct TestIoCallbacks {
    inner: NullIo,
    ports: Arc<Mutex<PortMockState>>,
    handshake: Option<Arc<IoBoardHandshakeMock>>,
}

impl TestIoCallbacks {
    /// ポート上書きなしの既定 IO モック。
    pub fn empty() -> Self {
        Self {
            inner: NullIo,
            ports: Arc::new(Mutex::new(PortMockState::default())),
            handshake: None,
        }
    }

    /// ioMock 設定から作る。
    pub fn from_entries(
        entries: &[CodeTestIoMockEntry],
    ) -> Result<TestIoCallbacks, FrameworkError> {
        Ok(CodeTestIoMock::new(entries)?.build_io_callbacks())
    }

    /// 書込ログ付きポート状態を返す。
    pub fn port_state(&self) -> Arc<Mutex<PortMockState>> {
        Arc::clone(&self.ports)
    }

    fn read_hshk(&self, port: u16) -> Option<u16> {
        let hs = self.handshake.as_ref()?;
        hs.wires.lock().expect("wires lock").read_port(port)
    }

    fn write_hshk(&self, port: u16, val: u16) {
        let Some(hs) = self.handshake.as_ref() else {
            return;
        };
        let mut wires = hs.wires.lock().expect("wires lock");
        wires.write_port(port, val);
        if port == IO_PORT_HSHK_OUT_CTRL {
            if (val & HSHK_CTRL_OUT_DENA) != 0 {
                wires.hshk_out_dack = 1;
            } else if wires.hshk_out_dena == 0 {
                wires.hshk_out_dack = 0;
            }
            if (val & HSHK_CTRL_OUT_REQ) != 0 {
                wires.hshk_out_dena = 0;
            }
        }
        if port == IO_PORT_HSHK_IN_CTRL && (val & HSHK_CTRL_IN_DACK) != 0 {
            wires.hshk_in_dena = 0;
        }
        if port == IO_PORT_HSHK_OUT_DATA {
            let _ = hs
                .link
                .lock()
                .expect("link lock")
                .push_cpu_to_io(&[(val & 0xff) as u8]);
        }
    }
}

impl IoCallbacks for TestIoCallbacks {
    fn io_read(&mut self, port: u16) -> u16 {
        if let Some(v) = self.ports.lock().expect("ports lock").reads.get(&port) {
            return *v;
        }
        if (HSHK_PORT_MIN..=HSHK_PORT_MAX).contains(&port) {
            if let Some(v) = self.read_hshk(port) {
                return v;
            }
            return DEFAULT_RD;
        }
        self.inner.io_read(port)
    }

    fn io_write(&mut self, port: u16, val: u16) {
        if (HSHK_PORT_MIN..=HSHK_PORT_MAX).contains(&port) {
            self.ports
                .lock()
                .expect("ports lock")
                .write_log
                .push((port, val));
            self.write_hshk(port, val);
            return;
        }
        self.inner.io_write(port, val);
    }
}

/// IO→CPU 要求がアサート中か（HSHK_IN_REQ または IN_DENA）。
pub fn is_io_to_cpu_request_asserted(mock: &IoBoardHandshakeMock) -> bool {
    let wires = mock.wires.lock().expect("wires lock");
    wires.hshk_in_req != 0 || wires.hshk_in_dena != 0
}

/// ポートモック状態から IN_REQ 相当を見る（互換 API）。
pub fn is_io_to_cpu_request_asserted_ports(ports: &PortMockState) -> bool {
    ports.reads.get(&IO_PORT_HSHK_IN_CTRL).copied().unwrap_or(0) & HSHK_IN_CTRL_IN_REQ != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_read_override() -> Result<(), FrameworkError> {
        let mut io = TestIoCallbacks::from_entries(&[CodeTestIoMockEntry::PortRead {
            port: IO_PORT_HSHK_IN_CTRL,
            value: HSHK_IN_CTRL_IN_REQ,
        }])?;
        assert_eq!(io.io_read(IO_PORT_HSHK_IN_CTRL), HSHK_IN_CTRL_IN_REQ);
        assert!(is_io_to_cpu_request_asserted_ports(
            &io.port_state().lock().expect("ports lock")
        ));
        Ok(())
    }

    #[test]
    fn handshake_entry_creates_mock() -> Result<(), FrameworkError> {
        let mock = CodeTestIoMock::new(&[CodeTestIoMockEntry::Handshake])?;
        assert!(mock.handshake.is_some());
        Ok(())
    }

    #[test]
    fn dispatch_mode_set() {
        let mock = IoBoardHandshakeMock::new();
        let resp = mock.dispatch_cpu_to_io(&[CMD_MODE_SET, MODE_FREE]);
        assert_eq!(resp, vec![RESPONSE_OK]);
        assert_eq!(mock.state.lock().expect("state").mode, MODE_FREE);
    }
}
