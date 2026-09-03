//! TMS9995 CRU ハンドシェイク線の同期 IO 側制御（HandShake.mdc）。

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::FrameworkError;

use super::cru_handshake::Tms9995CruHandshakeMock;

const DEFAULT_TIMEOUT_MS: u64 = 5000;

const IRQ_INTERRUPT_BUSY: u16 = 0x0010;
const CPU_OUT_HSHK_OUT_REQ: u16 = 0x0020;
const CPU_OUT_HSHK_OUT_DENA: u16 = 0x0021;
const CPU_OUT_HSHK_IN_DACK: u16 = 0x0022;
const CPU_IN_HSHK_IN_REQ: u16 = 0x0024;
const CPU_IN_HSHK_IN_DENA: u16 = 0x0025;
const CPU_IN_HSHK_OUT_DACK: u16 = 0x0026;

/// CRU ハンドシェイクモック上の IO 側同期制御。
pub struct Tms9995CruIoControlSync {
    cru: Arc<Mutex<Tms9995CruHandshakeMock>>,
    timeout_ms: u64,
}

impl Tms9995CruIoControlSync {
    /// 共有 CRU モックとタイムアウト ms で作る。
    pub fn new(cru: Arc<Mutex<Tms9995CruHandshakeMock>>, timeout_ms: u64) -> Self {
        Self {
            cru,
            timeout_ms: if timeout_ms == 0 {
                DEFAULT_TIMEOUT_MS
            } else {
                timeout_ms
            },
        }
    }

    /// CPU→IO 可変長フレームを 1 件受信する。
    pub fn receive_framed_adaptive<P>(
        &self,
        poll: &mut P,
        remaining: impl Fn(&[u8]) -> usize,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        self.wait_for_cpu_request(poll)?;
        let (first, second) = self.receive_unit_from_cpu(poll)?;
        let mut bytes = vec![first];
        let mut pending = vec![second];

        loop {
            let rem = remaining(&bytes);
            if rem == 0 {
                break;
            }
            if pending.is_empty() {
                match self.receive_unit_from_cpu(poll) {
                    Ok(pair) => {
                        pending.push(pair.0);
                        pending.push(pair.1);
                    }
                    Err(_) => break,
                }
            }
            bytes.push(pending.remove(0));
        }

        self.finalize_receive(poll)?;
        Ok(bytes)
    }

    /// IO→CPU セッション内で CPU 応答を論理バイト数だけ受信する。
    pub fn receive_bytes_from_cpu<P>(
        &self,
        poll: &mut P,
        length: usize,
    ) -> Result<Vec<u8>, FrameworkError>
    where
        P: FnMut(),
    {
        if length == 0 {
            return Ok(Vec::new());
        }
        let mut data = vec![0u8; length];
        let mut i = 0usize;
        while i < length {
            let (b0, b1) = self.receive_unit_from_cpu(poll)?;
            data[i] = b0;
            i += 1;
            if i < length {
                data[i] = b1;
                i += 1;
            }
        }
        Ok(data)
    }

    /// IO→CPU 方向へ応答を送る。
    pub fn send<P>(&self, poll: &mut P, data: &[u8], raise_irq: bool) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.initiate_send(poll, raise_irq)?;
        self.transfer_bytes_to_cpu(poll, data)?;
        self.finalize_send(poll)?;
        Ok(())
    }

    /// IO→CPU 要求を開始する。
    pub fn initiate_send<P>(&self, poll: &mut P, raise_irq: bool) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.initiate_send_inner(poll, raise_irq)
    }

    /// IO→CPU データ転送（同一 `IN_REQ` セッション内）。
    pub fn transfer_bytes_to_cpu<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.transfer_bytes_to_cpu_inner(poll, data)
    }

    /// IO→CPU セッション完了（`IN_REQ` を下ろす）。
    pub fn finalize_send<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.finalize_send_inner(poll)
    }

    fn wait<P, F>(&self, poll: &mut P, cond: F) -> Result<(), FrameworkError>
    where
        P: FnMut(),
        F: Fn(&Tms9995CruHandshakeMock) -> bool,
    {
        let start = Instant::now();
        loop {
            poll();
            let ok = self.cru.lock().expect("cru lock");
            if cond(&ok) {
                return Ok(());
            }
            drop(ok);
            if start.elapsed() >= Duration::from_millis(self.timeout_ms) {
                return Err(FrameworkError::invalid_argument("cru handshake timeout"));
            }
            std::thread::yield_now();
        }
    }

    fn wait_for_cpu_request<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_OUT_REQ).unwrap_or(0) != 0)?;
        let mut c = self.cru.lock().expect("cru lock");
        c.io_write_signal(CPU_IN_HSHK_OUT_DACK, 0)?;
        Ok(())
    }

    fn receive_unit_from_cpu<P>(&self, poll: &mut P) -> Result<(u8, u8), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_OUT_DENA).unwrap_or(0) != 0)?;
        let b0 = {
            let c = self.cru.lock().expect("cru lock");
            c.io_read_out_data_byte()
        };
        {
            let mut c = self.cru.lock().expect("cru lock");
            c.io_write_signal(CPU_IN_HSHK_OUT_DACK, 1)?;
        }
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_OUT_DENA).unwrap_or(0) == 0)?;
        let b1 = {
            let c = self.cru.lock().expect("cru lock");
            c.io_read_out_data_byte()
        };
        {
            let mut c = self.cru.lock().expect("cru lock");
            c.io_write_signal(CPU_IN_HSHK_OUT_DACK, 0)?;
        }
        Ok((b0, b1))
    }

    fn finalize_receive<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_OUT_REQ).unwrap_or(0) == 0)
    }

    fn initiate_send_inner<P>(&self, poll: &mut P, raise_irq: bool) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        if !raise_irq {
            self.wait(poll, |c| c.io_read_signal(CPU_IN_HSHK_IN_REQ).unwrap_or(0) == 0)?;
            {
                let mut c = self.cru.lock().expect("cru lock");
                c.io_write_signal(CPU_IN_HSHK_IN_DENA, 0)?;
                c.io_set_int1_cause(1)?;
                c.io_write_signal(CPU_IN_HSHK_IN_REQ, 1)?;
            }
            return self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_OUT_REQ).unwrap_or(0) == 0);
        }
        self.wait(poll, |c| {
            c.io_read_signal(IRQ_INTERRUPT_BUSY).unwrap_or(0) == 0
                && c.io_read_signal(CPU_OUT_HSHK_OUT_REQ).unwrap_or(0) == 0
                && c.io_read_signal(CPU_IN_HSHK_IN_REQ).unwrap_or(0) == 0
        })?;
        {
            let mut c = self.cru.lock().expect("cru lock");
            c.io_write_signal(CPU_IN_HSHK_IN_DENA, 0)?;
            c.io_set_int1_cause(1)?;
            c.io_write_signal(CPU_IN_HSHK_IN_REQ, 1)?;
        }
        Ok(())
    }

    fn transfer_unit_to_cpu<P>(&self, poll: &mut P, b0: u8, b1: u8) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        {
            let mut c = self.cru.lock().expect("cru lock");
            c.io_write_in_data_byte(b0)?;
            c.io_write_signal(CPU_IN_HSHK_IN_DENA, 1)?;
        }
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_IN_DACK).unwrap_or(0) != 0)?;
        {
            let mut c = self.cru.lock().expect("cru lock");
            c.io_write_in_data_byte(b1)?;
            c.io_write_signal(CPU_IN_HSHK_IN_DENA, 0)?;
        }
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_IN_DACK).unwrap_or(0) == 0)
    }

    fn transfer_bytes_to_cpu_inner<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        let mut i = 0;
        while i < data.len() {
            let b0 = data[i];
            let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
            self.transfer_unit_to_cpu(poll, b0, b1)?;
            i += 2;
        }
        Ok(())
    }

    fn finalize_send_inner<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |c| c.io_read_signal(CPU_OUT_HSHK_IN_DACK).unwrap_or(0) == 0)?;
        let mut c = self.cru.lock().expect("cru lock");
        c.io_write_signal(CPU_IN_HSHK_IN_REQ, 0)?;
        Ok(())
    }
}
