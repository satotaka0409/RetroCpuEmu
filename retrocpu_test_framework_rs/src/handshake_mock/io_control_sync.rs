//! 同期ハンドシェイク線制御（IO ボード側。HandShake.mdc）。

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use retrocpu_emu_rs::cpuboard::{
    Mn1613HandshakeWires as HandshakeWires, MN1613_INT2_CAUSE_HANDSHAKE as INT2_CAUSE_HANDSHAKE,
};

use crate::error::FrameworkError;

const DEFAULT_TIMEOUT_MS: u64 = 5000;

/// IO ボード側の同期ハンドシェイク制御。
pub struct IoControlSync {
    wires: Arc<Mutex<HandshakeWires>>,
    timeout_ms: u64,
}

impl IoControlSync {
    /// 線状態とタイムアウト ms で作る。
    pub fn new(wires: Arc<Mutex<HandshakeWires>>, timeout_ms: u64) -> Self {
        Self {
            wires,
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

    /// IO→CPU 方向へ応答を送る。`raise_irq=false` は CPU→IO 応答（INT2 なし）。
    pub fn send<P>(&self, poll: &mut P, data: &[u8], raise_irq: bool) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.initiate_send(poll, raise_irq)?;
        self.transfer_bytes_to_cpu(poll, data)?;
        self.finalize_send(poll)?;
        Ok(())
    }

    fn wait<P, F>(&self, poll: &mut P, cond: F) -> Result<(), FrameworkError>
    where
        P: FnMut(),
        F: Fn(&HandshakeWires) -> bool,
    {
        let start = Instant::now();
        loop {
            poll();
            let ok = self.wires.lock().expect("wires lock");
            if cond(&ok) {
                return Ok(());
            }
            drop(ok);
            if start.elapsed() >= Duration::from_millis(self.timeout_ms) {
                return Err(FrameworkError::invalid_argument("handshake timeout"));
            }
            std::thread::yield_now();
        }
    }

    fn wait_for_cpu_request<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |w| w.hshk_out_req != 0)?;
        let mut w = self.wires.lock().expect("wires lock");
        w.hshk_out_dack = 0;
        Ok(())
    }

    fn receive_unit_from_cpu<P>(&self, poll: &mut P) -> Result<(u8, u8), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |w| w.hshk_out_dena != 0)?;
        let b0 = {
            let w = self.wires.lock().expect("wires lock");
            w.hshk_out_data
        };
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_out_dack = 1;
        }
        self.wait(poll, |w| w.hshk_out_dena == 0)?;
        let b1 = {
            let w = self.wires.lock().expect("wires lock");
            w.hshk_out_data
        };
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_out_dack = 0;
        }
        Ok((b0, b1))
    }

    fn finalize_receive<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |w| w.hshk_out_req == 0)
    }

    fn initiate_send<P>(&self, poll: &mut P, raise_irq: bool) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        if !raise_irq {
            self.wait(poll, |w| w.hshk_in_req == 0)?;
            {
                let mut w = self.wires.lock().expect("wires lock");
                w.hshk_in_dena = 0;
                w.int_cause = INT2_CAUSE_HANDSHAKE;
                w.hshk_in_req = 1;
            }
            return self.wait(poll, |w| w.hshk_out_req == 0);
        }
        self.wait(poll, |w| {
            w.interrupt_busy == 0 && w.hshk_out_req == 0 && w.hshk_in_req == 0
        })?;
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_in_dena = 0;
            w.int_cause = INT2_CAUSE_HANDSHAKE;
            w.hshk_in_req = 1;
        }
        Ok(())
    }

    fn transfer_unit_to_cpu<P>(&self, poll: &mut P, b0: u8, b1: u8) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_in_data = b0;
            w.hshk_in_dena = 1;
        }
        self.wait(poll, |w| w.hshk_in_dack != 0)?;
        {
            let mut w = self.wires.lock().expect("wires lock");
            w.hshk_in_data = b1;
            w.hshk_in_dena = 0;
        }
        self.wait(poll, |w| w.hshk_in_dack == 0)
    }

    fn transfer_bytes_to_cpu<P>(&self, poll: &mut P, data: &[u8]) -> Result<(), FrameworkError>
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

    fn finalize_send<P>(&self, poll: &mut P) -> Result<(), FrameworkError>
    where
        P: FnMut(),
    {
        self.wait(poll, |w| w.hshk_in_dack == 0)?;
        let mut w = self.wires.lock().expect("wires lock");
        w.hshk_in_req = 0;
        Ok(())
    }
}
