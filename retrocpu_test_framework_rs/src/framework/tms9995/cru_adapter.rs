//! `Tms9995CruHandshakeMock` を `retrocpu_emu_rs::Tms9995Cru` へ接続するアダプタ。

use std::sync::{Arc, Mutex};

use retrocpu_emu_rs::cpuboard::{Tms9995Cru, Tms9995CruBus};

use super::cru_handshake::Tms9995CruHandshakeMock;

const CRU_BIT_MIN: u16 = 0x0010;
const CRU_BIT_MAX: u16 = 0x0027;

fn in_handshake_region(addr: u16) -> bool {
    (CRU_BIT_MIN..=CRU_BIT_MAX).contains(&addr)
}

/// CRU ハンドシェイクモックを CPU コアの CRU バスとして使う。
#[derive(Debug, Clone)]
pub struct Tms9995CruHandshakeAdapter {
    mock: Arc<Mutex<Tms9995CruHandshakeMock>>,
}

impl Tms9995CruHandshakeAdapter {
    /// 共有モック参照からアダプタを作る。
    pub fn new(mock: Arc<Mutex<Tms9995CruHandshakeMock>>) -> Self {
        Self { mock }
    }
}

impl Tms9995Cru for Tms9995CruHandshakeAdapter {
    fn read_bit(&self, addr: u16) -> bool {
        if !in_handshake_region(addr) {
            return false;
        }
        self.mock
            .lock()
            .expect("cru mock lock")
            .cpu_read_signal(addr)
            .unwrap_or(0)
            != 0
    }

    fn write_bit(&mut self, addr: u16, value: bool) {
        if !in_handshake_region(addr) {
            return;
        }
        let _ = self
            .mock
            .lock()
            .expect("cru mock lock")
            .cpu_write_signal(addr, u8::from(value));
    }

    fn read_data_byte(&self) -> u8 {
        self.mock
            .lock()
            .expect("cru mock lock")
            .cpu_read_in_data_byte()
    }

    fn write_data_byte(&mut self, value: u8) {
        let _ = self
            .mock
            .lock()
            .expect("cru mock lock")
            .cpu_write_out_data_byte(value);
    }
}

/// 空 CRU（ハンドシェイク無し）をラップする薄いアダプタ。
#[derive(Debug, Default)]
pub struct Tms9995EmptyCruAdapter {
    bus: Tms9995CruBus,
}

impl Tms9995EmptyCruAdapter {
    /// 空 CRU バスで作る。
    pub fn new() -> Self {
        Self::default()
    }

    /// 内部 CRU バスへの参照。
    pub fn bus(&self) -> &Tms9995CruBus {
        &self.bus
    }

    /// 内部 CRU バスへの可変参照。
    pub fn bus_mut(&mut self) -> &mut Tms9995CruBus {
        &mut self.bus
    }
}

impl Tms9995Cru for Tms9995EmptyCruAdapter {
    fn read_bit(&self, addr: u16) -> bool {
        self.bus.read_bit(addr)
    }

    fn write_bit(&mut self, addr: u16, value: bool) {
        self.bus.write_bit(addr, value);
    }

    fn read_data_byte(&self) -> u8 {
        self.bus.read_data_byte()
    }

    fn write_data_byte(&mut self, value: u8) {
        self.bus.write_data_byte(value);
    }
}
