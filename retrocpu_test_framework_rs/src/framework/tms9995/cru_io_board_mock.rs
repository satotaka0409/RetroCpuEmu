//! TMS9995 CRU ハンドシェイク IO ボードモック（テスト用）。

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::error::FrameworkError;
use crate::handshake_mock::{
    cpu_to_io_remaining_size_tms9995, dispatch_cpu_to_io, IoBoardMockState,
    BREAK_HISTORY_ENTRY_SIZE_TMS9995,
};

use super::cru_handshake::Tms9995CruHandshakeMock;
use super::cru_io_control_sync::Tms9995CruIoControlSync;

const DEFAULT_HANDSHAKE_TIMEOUT_MS: u64 = 5000;

const CPU_OUT_HSHK_OUT_REQ: u16 = 0x0020;
const CPU_OUT_HSHK_OUT_DENA: u16 = 0x0021;
const CPU_OUT_HSHK_IN_DACK: u16 = 0x0022;
const CPU_IN_HSHK_IN_REQ: u16 = 0x0024;
const CPU_IN_HSHK_IN_DENA: u16 = 0x0025;
const CPU_IN_HSHK_OUT_DACK: u16 = 0x0026;
const IRQ_INTERRUPT_BUSY: u16 = 0x0010;

/// TMS9995 CRU 線 + IO ボード状態モック。
#[derive(Debug)]
pub struct Tms9995CruIoBoardMock {
    pub cru: Arc<Mutex<Tms9995CruHandshakeMock>>,
    pub state: Arc<Mutex<IoBoardMockState>>,
    timeout_ms: u64,
}

impl Tms9995CruIoBoardMock {
    /// 空の CRU IO モックを作る。
    pub fn new(cru: Arc<Mutex<Tms9995CruHandshakeMock>>) -> Self {
        Self::with_timeout(cru, DEFAULT_HANDSHAKE_TIMEOUT_MS)
    }

    /// タイムアウト ms を指定して作る。
    pub fn with_timeout(cru: Arc<Mutex<Tms9995CruHandshakeMock>>, timeout_ms: u64) -> Self {
        Self {
            cru,
            state: Arc::new(Mutex::new(IoBoardMockState::new())),
            timeout_ms,
        }
    }

    /// 線状態と IO 状態をリセットする。
    pub fn reset(&self) {
        self.cru.lock().expect("cru lock").reset();
        *self.state.lock().expect("state lock") = IoBoardMockState::new();
    }

    /// CPU→IO フレームを処理し、IO→CPU 応答バイト列を返す。
    pub fn dispatch_cpu_to_io(&self, frame: &[u8]) -> Vec<u8> {
        dispatch_cpu_to_io(&mut self.state.lock().expect("state lock"), frame)
    }

    fn wait_out_req<P>(&self, poll: &mut P, timeout: Duration) -> bool
    where
        P: FnMut(),
    {
        let start = std::time::Instant::now();
        loop {
            if self
                .cru
                .lock()
                .expect("cru lock")
                .io_read_signal(CPU_OUT_HSHK_OUT_REQ)
                .unwrap_or(0)
                != 0
            {
                return true;
            }
            if start.elapsed() >= timeout {
                return false;
            }
            poll();
            thread::yield_now();
        }
    }

    /// CPU→IO を 1 トランザクション処理する。
    pub fn handle_one_request<P>(&self, poll: &mut P) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        let io = Tms9995CruIoControlSync::new(Arc::clone(&self.cru), self.timeout_ms);
        let frame = io.receive_framed_adaptive(poll, |so_far| {
            cpu_to_io_remaining_size_tms9995(so_far, BREAK_HISTORY_ENTRY_SIZE_TMS9995)
        })?;
        let response = self.dispatch_cpu_to_io(&frame);
        if !response.is_empty() {
            io.send(poll, &response, false)?;
        }
        Ok(response)
    }

    /// IO→CPU 1 フレームを線上へ送る。
    pub fn feed_io_to_cpu<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        let io = Tms9995CruIoControlSync::new(Arc::clone(&self.cru), self.timeout_ms);
        io.send(poll, data, false)
    }

    /// `call` 完了後に CPU→IO 応答を線から読み出す。
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
        let io = Tms9995CruIoControlSync::new(Arc::clone(&self.cru), self.timeout_ms);
        io.receive_framed_adaptive(poll, |so_far| from_cpu_len.saturating_sub(so_far.len()))
            .map(|mut frame| {
                frame.truncate(from_cpu_len);
                frame
            })
    }

    /// IO→CPU フレームを送信し、CPU→IO 応答を指定バイト数だけ受信する。
    pub fn exchange_with_cpu<P>(
        &self,
        to_cpu: &[u8],
        from_cpu_len: usize,
        poll: &mut P,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        let io = Tms9995CruIoControlSync::new(Arc::clone(&self.cru), self.timeout_ms);
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

    /// 13h 後の UNDEF LED 状態。
    pub fn undef_led(&self) -> bool {
        self.state.lock().expect("state lock").undef_led
    }

    /// ハンドシェイク転送線だけアイドルに戻す。
    pub fn reset_handshake_activity(&self) {
        let mut c = self.cru.lock().expect("cru lock");
        let _ = c.io_write_signal(CPU_OUT_HSHK_OUT_REQ, 0);
        let _ = c.io_write_signal(CPU_OUT_HSHK_OUT_DENA, 0);
        let _ = c.io_write_signal(CPU_OUT_HSHK_IN_DACK, 0);
        let _ = c.io_write_signal(CPU_IN_HSHK_IN_REQ, 0);
        let _ = c.io_write_signal(CPU_IN_HSHK_IN_DENA, 0);
        let _ = c.io_write_signal(CPU_IN_HSHK_OUT_DACK, 0);
        let _ = c.io_write_signal(IRQ_INTERRUPT_BUSY, 0);
    }

    /// IO→CPU を送りつつ `run_handler` と並行し、CPU→IO 応答を返す。
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

    /// `run_io_handler_exchange` に追加 IO→CPU を足した版。
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
        let io_mock = Arc::clone(self);
        let frame = to_cpu.to_vec();
        let tail = then_to_cpu.map(|s| s.to_vec());
        let worker = thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || thread::yield_now();
            let sync = Tms9995CruIoControlSync::new(Arc::clone(&io_mock.cru), io_mock.timeout_ms);
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
            .map_err(|_| FrameworkError::invalid_argument("cru io worker panicked"))?;
        handler_result.map_err(|e| {
            FrameworkError::invalid_argument(format!("g_handshake_interrupt_handler call: {e}"))
        })?;
        io_result.map_err(|e| FrameworkError::invalid_argument(format!("cru io exchange: {e}")))
    }

    /// CPU→IO 1 トランザクションを `run_cpu` と並行処理する。
    pub fn run_with_cpu_to_io_request<F>(
        self: &Arc<Self>,
        run_cpu: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.reset_handshake_activity();
        let io_mock = Arc::clone(self);
        let worker = thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || thread::yield_now();
            io_mock.handle_one_request(&mut poll)
        });
        run_cpu()?;
        worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("cru io worker panicked"))?
            .map_err(|e| FrameworkError::invalid_argument(format!("cpu_to_io serve: {e}")))
    }

    /// CPU→IO バイト列を線から受信する（dispatch なし）。
    pub fn run_with_cpu_out_capture<F>(
        self: &Arc<Self>,
        expected_len: usize,
        run_cpu: F,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        F: FnOnce() -> Result<(), FrameworkError>,
    {
        self.reset_handshake_activity();
        let io_mock = Arc::clone(self);
        let worker = thread::spawn(move || -> Result<Vec<u8>, FrameworkError> {
            let mut poll = || thread::yield_now();
            io_mock.receive_cpu_to_io(&mut poll, expected_len)
        });
        run_cpu()?;
        worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("cru io worker panicked"))?
            .map_err(|e| FrameworkError::invalid_argument(format!("cpu out capture: {e}")))
    }
}
