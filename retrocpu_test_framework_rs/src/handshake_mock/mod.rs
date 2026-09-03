//! テスト用 IO モック（MN1613 ポート 0x20–0x25 + handshake）。
//!
//! 根拠: `retrocpu_test_framework_ts/src/handshake_mock.ts` / emulater_code_test.mdc

mod cpu_to_io;
mod io_control_sync;
mod mock_state;
mod types;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use retrocpu_emu_rs::cpuboard::{
    Mn1613FrameLink as FrameLink, Mn1613HandshakeTransport as HandshakeTransport,
    Mn1613HandshakeWires as HandshakeWires, Mn1613IoCallbacks as IoCallbacks,
    Mn1613NullIo as NullIo, MN1613_HSHK_CTRL_IN_DACK as HSHK_CTRL_IN_DACK,
    MN1613_HSHK_IN_CTRL_IN_REQ as HSHK_IN_CTRL_IN_REQ,
    MN1613_INT2_CAUSE_HANDSHAKE as INT2_CAUSE_HANDSHAKE,
    MN1613_IO_PORT_HSHK_IN_CTRL as IO_PORT_HSHK_IN_CTRL,
};

pub use cpu_to_io::{
    cpu_to_io_remaining_size, cpu_to_io_remaining_size_tms9995, dispatch_cpu_to_io,
};
pub use mock_state::{
    BeepParams, BreakNotifyInfo, IoBoardMockState, LedDisplayData, TimerParams,
};
pub use types::{
    BREAK_HISTORY_ENTRY_SIZE_TMS9995, CMD_MODE_SET, MODE_FREE, MODE_MONITOR, RESPONSE_OK,
};

use crate::error::FrameworkError;
use crate::framework::mn1613::types::PortMockState;
use crate::json_value::CodeTestIoMockEntry;

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
    pub fn dispatch_cpu_to_io(&self, frame: &[u8]) -> Vec<u8> {
        dispatch_cpu_to_io(&mut self.state.lock().expect("state lock"), frame)
    }

    fn wait_in_dack<P>(
        &self,
        poll: &mut P,
        timeout: Duration,
        pred: impl Fn(u8) -> bool,
    ) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        let start = Instant::now();
        loop {
            poll();
            let dack = self.wires.lock().expect("wires lock").hshk_in_dack;
            if pred(dack) {
                return Ok(());
            }
            if start.elapsed() > timeout {
                return Err(FrameworkError::invalid_argument(
                    "timeout waiting hshk_in_dack",
                ));
            }
            std::thread::yield_now();
        }
    }

    /// CPU の OUT_REQ が立つまで短時間ポーリングする（TS `serveLoop` 相当）。
    fn wait_out_req<P>(&self, poll: &mut P, timeout: Duration) -> bool
    where
        P: FnMut(),
    {
        let start = Instant::now();
        loop {
            if self.wires.lock().expect("wires lock").hshk_out_req != 0 {
                return true;
            }
            if start.elapsed() >= timeout {
                return false;
            }
            poll();
            std::thread::yield_now();
        }
    }

    /// IO→CPU 応答バイト列を線上へ送る（CPU→IO 応答用。INT2 は上げない）。
    pub fn feed_io_response<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        let timeout = Duration::from_millis(self.timeout_ms);
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_in_req = 1;
            w.hshk_in_dena = 0;
            w.int_cause = INT2_CAUSE_HANDSHAKE;
        }
        let mut i = 0usize;
        while i < data.len() {
            let b0 = data[i];
            let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
            {
                let mut w = self.wires.lock().expect("wires lock");
                w.hshk_in_data = b0;
                w.hshk_in_dena = 1;
            }
            self.wait_in_dack(poll, timeout, |d| d != 0)?;
            {
                let mut w = self.wires.lock().expect("wires lock");
                w.hshk_in_data = b1;
                w.hshk_in_dena = 0;
            }
            self.wait_in_dack(poll, timeout, |d| d == 0)?;
            i += 2;
        }
        self.wires.lock().expect("wires lock").hshk_in_req = 0;
        Ok(())
    }

    /// CPU→IO を 1 トランザクション処理（線シミュレーション + 可変長 1Ah）。
    pub fn handle_one_request<P>(&self, poll: &mut P) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        let io = IoControlSync::new(Arc::clone(&self.wires), self.timeout_ms);
        let frame = io.receive_framed_adaptive(poll, |so_far| {
            cpu_to_io_remaining_size(so_far, BREAK_HISTORY_ENTRY_SIZE_MN1613)
        })?;
        let response = self.dispatch_cpu_to_io(&frame);
        if !response.is_empty() {
            self.feed_io_response(poll, &response)?;
        }
        Ok(response)
    }

    /// IO→CPU 1 フレームを線上へ送る（`g_handshake_interrupt_handler` を `call` するテスト向け）。
    pub fn feed_io_to_cpu<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.feed_io_response(poll, data)
    }

    /// `call` 完了後に CPU→IO 応答を線から読み出す（独立 `OUT_REQ` トランザクション向け）。
    pub fn receive_cpu_to_io<P>(
        &self,
        poll: &mut P,
        from_cpu_len: usize,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        if from_cpu_len == 0 {
            return Ok(Vec::new());
        }
        let io = IoControlSync::new(Arc::clone(&self.wires), self.timeout_ms);
        io.receive_framed_adaptive(poll, |so_far| from_cpu_len.saturating_sub(so_far.len()))
            .map(|mut frame| {
                frame.truncate(from_cpu_len);
                frame
            })
    }

    /// IO→CPU フレームを送信し、CPU→IO 応答を指定バイト数だけ受信する。
    ///
    /// TS の `exchangeWithCpu(toCpu, fromCpu)` 相当。
    /// `call` 直列のテストでは `run_io_handler_exchange` を使う。
    pub fn exchange_with_cpu<P>(
        &self,
        to_cpu: &[u8],
        from_cpu_len: usize,
        poll: &mut P,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        let io = IoControlSync::new(Arc::clone(&self.wires), self.timeout_ms);
        io.initiate_send(poll, false)?;
        io.transfer_bytes_to_cpu(poll, to_cpu)?;
        let reply = if from_cpu_len > 0 {
            io.receive_bytes_from_cpu(poll, from_cpu_len)?
        } else {
            Vec::new()
        };
        io.finalize_send(poll)?;
        Ok(reply)
    }

    /// 64bit タイマー応答（11h）を設定する。
    pub fn set_timestamp_u64(&self, value: u64) {
        self.state
            .lock()
            .expect("state lock")
            .set_timestamp_u64(value);
    }

    /// IO:0021 割り込み要因（下位 3bit）を設定する。
    pub fn set_int_cause(&self, cause: u8) {
        self.wires.lock().expect("wires lock").int_cause = cause & 0x07;
    }

    /// 直近 1Ah ブレイク通知。
    pub fn last_break_notify(&self) -> Option<BreakNotifyInfo> {
        self.state.lock().expect("state lock").last_break_notify.clone()
    }

    /// 13h 後の UNDEF LED 状態。
    pub fn undef_led(&self) -> bool {
        self.state.lock().expect("state lock").undef_led
    }

    /// モック状態の通知記録をクリアする。
    pub fn clear_notify_state(&self) {
        let mut st = self.state.lock().expect("state lock");
        st.last_break_notify = None;
        st.undef_led = false;
    }

    /// ハンドシェイク転送線だけアイドルに戻す（応答 DACK 未完了の残骸を消す）。
    pub fn reset_handshake_activity(&self) {
        let mut w = self.wires.lock().expect("wires lock");
        w.hshk_out_req = 0;
        w.hshk_out_dena = 0;
        w.hshk_in_dack = 0;
        w.hshk_in_req = 0;
        w.hshk_in_dena = 0;
        w.hshk_out_dack = 0;
        w.interrupt_busy = 0;
    }

    /// IO→CPU を送りつつ `run_handler`（通常 `session.call(g_handshake_interrupt_handler)`）と並行し、CPU→IO 応答を返す。
    pub fn run_io_handler_exchange<F>(
        self: &Arc<Self>,
        to_cpu: &[u8],
        from_cpu_len: usize,
        run_handler: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.run_io_handler_exchange_ext(to_cpu, from_cpu_len, None, run_handler)
    }

    /// `run_io_handler_exchange` に、CPU 応答後の追加 IO→CPU（13h status 等）を足した版。
    pub fn run_io_handler_exchange_ext<F>(
        self: &Arc<Self>,
        to_cpu: &[u8],
        from_cpu_len: usize,
        then_to_cpu: Option<&[u8]>,
        run_handler: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.reset_handshake_activity();
        let io = Arc::clone(self);
        let frame = to_cpu.to_vec();
        let tail = then_to_cpu.map(|s| s.to_vec());
        let worker = std::thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || std::thread::yield_now();
            let sync = IoControlSync::new(Arc::clone(&io.wires), io.timeout_ms);
            sync.initiate_send(&mut poll, false)?;
            sync.transfer_bytes_to_cpu(&mut poll, &frame)?;
            let reply = if from_cpu_len > 0 {
                sync.receive_bytes_from_cpu(&mut poll, from_cpu_len)?
            } else {
                Vec::new()
            };
            if let Some(extra) = tail.as_ref() {
                if !extra.is_empty() {
                    sync.transfer_bytes_to_cpu(&mut poll, extra)?;
                }
            }
            sync.finalize_send(&mut poll)?;
            Ok(reply)
        });
        let handler_result = run_handler();
        let io_result = worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?;
        handler_result.map_err(|e| {
            FrameworkError::invalid_argument(format!("g_handshake_interrupt_handler call: {e}"))
        })?;
        io_result.map_err(|e| FrameworkError::invalid_argument(format!("io exchange: {e}")))
    }

    /// CPU→IO 1 トランザクションを `run_cpu` と並行処理する（TS `Promise.all([call, handleOneRequest])` 相当）。
    pub fn run_with_cpu_to_io_request<F>(
        self: &Arc<Self>,
        run_cpu: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.reset_handshake_activity();
        let io = Arc::clone(self);
        let worker = std::thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || std::thread::yield_now();
            io.handle_one_request(&mut poll)
        });
        run_cpu()?;
        worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?
            .map_err(|e| FrameworkError::invalid_argument(format!("cpu_to_io serve: {e}")))
    }

    /// `g_hshk_*` 送信のみ検証向け。CPU→IO バイト列を線から受信する（dispatch なし）。
    pub fn run_with_cpu_out_capture<F>(
        self: &Arc<Self>,
        expected_len: usize,
        run_cpu: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.reset_handshake_activity();
        let io = Arc::clone(self);
        let worker = std::thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || std::thread::yield_now();
            io.receive_cpu_to_io(&mut poll, expected_len)
        });
        run_cpu()?;
        worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?
            .map_err(|e| FrameworkError::invalid_argument(format!("cpu out capture: {e}")))
    }

    /// CPU→IO 応答をバックグラウンドで処理する（TS `start()` 相当）。
    pub fn start_serve(self: &Arc<Self>) -> BackgroundServe {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let mock = Arc::clone(self);
        let join = thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                let mut poll = || std::thread::yield_now();
                if !mock.wait_out_req(&mut poll, Duration::from_millis(1)) {
                    continue;
                }
                match mock.handle_one_request(&mut poll) {
                    Ok(_) => {}
                    Err(e)
                        if e.to_string().contains("timeout")
                            || e.to_string().contains("ENA0") =>
                    {
                        continue;
                    }
                    Err(_) => break,
                }
            }
        });
        BackgroundServe { stop, join: Some(join) }
    }
}

/// `start_serve` の停止ハンドル。
pub struct BackgroundServe {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl BackgroundServe {
    /// 受信ループを止める（TS `stop()` 相当）。
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
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
        if port == IO_PORT_HSHK_IN_CTRL && (val & HSHK_CTRL_IN_DACK) != 0 {
            wires.hshk_in_dena = 0;
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
