//! TMS9995 CRU ハンドシェイク／割り込み要因モック。
//!
//! 根拠: `retrocpu_test_framework_ts/src/tms9995/cru_handshake.ts`

use std::collections::HashMap;

use crate::error::FrameworkError;

const BIT_MIN: u16 = 0x0010;
const BIT_MAX: u16 = 0x0027;

const IRQ_INTERRUPT_BUSY: u16 = 0x0010;
const IRQ_INT1_CAUSE: u16 = 0x0011;
const IRQ_INT2_CAUSE: u16 = 0x0012;

const CPU_OUT_HSHK_OUT_REQ: u16 = 0x0020;
const CPU_OUT_HSHK_OUT_DENA: u16 = 0x0021;
const CPU_OUT_HSHK_IN_DACK: u16 = 0x0022;
const CPU_OUT_DATA: u16 = 0x0023;

const CPU_IN_HSHK_IN_REQ: u16 = 0x0024;
const CPU_IN_HSHK_IN_DENA: u16 = 0x0025;
const CPU_IN_HSHK_OUT_DACK: u16 = 0x0026;
const CPU_IN_DATA: u16 = 0x0027;

/// CRU ハンドシェイク領域。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tms9995CruHandshakeRegion {
    pub bit_addr_min: u16,
    pub bit_addr_max: u16,
}

pub const TMS9995_CRU_HANDSHAKE_REGION: Tms9995CruHandshakeRegion = Tms9995CruHandshakeRegion {
    bit_addr_min: BIT_MIN,
    bit_addr_max: BIT_MAX,
};

/// 信号名 → CRU ビットアドレス。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tms9995CruHandshakeSignals {
    pub interrupt_busy: u16,
    pub int1_cause: u16,
    pub int2_cause: u16,
    pub hshk_out_req: u16,
    pub hshk_out_dena: u16,
    pub hshk_in_dack: u16,
    pub hshk_in_req: u16,
    pub hshk_in_dena: u16,
    pub hshk_out_dack: u16,
}

pub const TMS9995_CRU_HANDSHAKE_SIGNALS: Tms9995CruHandshakeSignals = Tms9995CruHandshakeSignals {
    interrupt_busy: IRQ_INTERRUPT_BUSY,
    int1_cause: IRQ_INT1_CAUSE,
    int2_cause: IRQ_INT2_CAUSE,
    hshk_out_req: CPU_OUT_HSHK_OUT_REQ,
    hshk_out_dena: CPU_OUT_HSHK_OUT_DENA,
    hshk_in_dack: CPU_OUT_HSHK_IN_DACK,
    hshk_in_req: CPU_IN_HSHK_IN_REQ,
    hshk_in_dena: CPU_IN_HSHK_IN_DENA,
    hshk_out_dack: CPU_IN_HSHK_OUT_DACK,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tms9995CruActor {
    Cpu,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CruHandshakeOptions {
    pub strict_roles: bool,
}

impl Default for Tms9995CruHandshakeOptions {
    fn default() -> Self {
        Self {
            strict_roles: true,
        }
    }
}

fn fmt_bit_addr(bit_addr: u16) -> String {
    format!("0x{bit_addr:04X}")
}

fn cpu_writable(bit: u16) -> bool {
    matches!(
        bit,
        IRQ_INTERRUPT_BUSY | CPU_OUT_HSHK_OUT_REQ | CPU_OUT_HSHK_OUT_DENA | CPU_OUT_HSHK_IN_DACK | CPU_OUT_DATA
    )
}

fn io_writable(bit: u16) -> bool {
    matches!(
        bit,
        IRQ_INT1_CAUSE
            | IRQ_INT2_CAUSE
            | CPU_IN_HSHK_IN_REQ
            | CPU_IN_HSHK_IN_DENA
            | CPU_IN_HSHK_OUT_DACK
            | CPU_IN_DATA
    )
}

fn cpu_readable(bit: u16) -> bool {
    io_writable(bit)
}

fn io_readable(bit: u16) -> bool {
    cpu_writable(bit)
}

/// CRU ハンドシェイクモック。
#[derive(Debug, Clone)]
pub struct Tms9995CruHandshakeMock {
    strict_roles: bool,
    bits: HashMap<u16, u8>,
    out_data_byte: u8,
    in_data_byte: u8,
}

impl Default for Tms9995CruHandshakeMock {
    fn default() -> Self {
        Self::new(Tms9995CruHandshakeOptions::default())
    }
}

impl Tms9995CruHandshakeMock {
    /// オプション付きで作る。
    pub fn new(options: Tms9995CruHandshakeOptions) -> Self {
        Self {
            strict_roles: options.strict_roles,
            bits: HashMap::new(),
            out_data_byte: 0,
            in_data_byte: 0,
        }
    }

    fn check_range(bit: u16) -> Result<(), FrameworkError> {
        if !(BIT_MIN..=BIT_MAX).contains(&bit) {
            return Err(FrameworkError::invalid_argument(format!(
                "bit address out of handshake region: {}",
                fmt_bit_addr(bit)
            )));
        }
        Ok(())
    }

    /// 任意ビットを読む。
    pub fn read_bit(&self, actor: Tms9995CruActor, bit: u16) -> Result<u8, FrameworkError> {
        Self::check_range(bit)?;
        if self.strict_roles {
            let ok = match actor {
                Tms9995CruActor::Cpu => cpu_readable(bit),
                Tms9995CruActor::Io => io_readable(bit),
            };
            if !ok {
                return Err(FrameworkError::invalid_argument(format!(
                    "{:?} cannot read {}",
                    actor,
                    fmt_bit_addr(bit)
                )));
            }
        }
        if bit == CPU_OUT_DATA {
            return Ok(self.out_data_byte & 1);
        }
        if bit == CPU_IN_DATA {
            return Ok(self.in_data_byte & 1);
        }
        Ok(*self.bits.get(&bit).unwrap_or(&0))
    }

    /// 任意ビットを書く。
    pub fn write_bit(&mut self, actor: Tms9995CruActor, bit: u16, value: u8) -> Result<(), FrameworkError> {
        Self::check_range(bit)?;
        if value != 0 && value != 1 {
            return Err(FrameworkError::invalid_argument(format!(
                "bit must be 0 or 1 (got {value})"
            )));
        }
        if self.strict_roles {
            let ok = match actor {
                Tms9995CruActor::Cpu => cpu_writable(bit),
                Tms9995CruActor::Io => io_writable(bit),
            };
            if !ok {
                return Err(FrameworkError::invalid_argument(format!(
                    "{:?} cannot write {}",
                    actor,
                    fmt_bit_addr(bit)
                )));
            }
        }
        if bit == CPU_OUT_DATA {
            self.out_data_byte = (self.out_data_byte & !1) | (value & 1);
        } else if bit == CPU_IN_DATA {
            self.in_data_byte = (self.in_data_byte & !1) | (value & 1);
        }
        self.bits.insert(bit, value);
        Ok(())
    }

    pub fn cpu_write_signal(&mut self, bit: u16, value: u8) -> Result<(), FrameworkError> {
        self.write_bit(Tms9995CruActor::Cpu, bit, value)
    }

    pub fn io_read_signal(&self, bit: u16) -> Result<u8, FrameworkError> {
        self.read_bit(Tms9995CruActor::Io, bit)
    }

    pub fn io_write_signal(&mut self, bit: u16, value: u8) -> Result<(), FrameworkError> {
        self.write_bit(Tms9995CruActor::Io, bit, value)
    }

    pub fn cpu_read_signal(&self, bit: u16) -> Result<u8, FrameworkError> {
        self.read_bit(Tms9995CruActor::Cpu, bit)
    }

    pub fn cpu_write_out_data_byte(&mut self, value: u8) -> Result<(), FrameworkError> {
        self.out_data_byte = value;
        self.bits.insert(CPU_OUT_DATA, value & 1);
        Ok(())
    }

    pub fn io_read_out_data_byte(&self) -> u8 {
        self.out_data_byte
    }

    pub fn io_write_in_data_byte(&mut self, value: u8) -> Result<(), FrameworkError> {
        self.in_data_byte = value;
        self.bits.insert(CPU_IN_DATA, value & 1);
        Ok(())
    }

    pub fn cpu_read_in_data_byte(&self) -> u8 {
        self.in_data_byte
    }

    pub fn io_set_int1_cause(&mut self, value: u8) -> Result<(), FrameworkError> {
        self.write_bit(Tms9995CruActor::Io, IRQ_INT1_CAUSE, value & 1)
    }

    pub fn cpu_read_int1_cause(&self) -> Result<u8, FrameworkError> {
        self.cpu_read_signal(IRQ_INT1_CAUSE)
    }

    pub fn io_set_int2_cause(&mut self, value: u8) -> Result<(), FrameworkError> {
        self.write_bit(Tms9995CruActor::Io, IRQ_INT2_CAUSE, value & 1)
    }

    pub fn cpu_read_int2_cause(&self) -> Result<u8, FrameworkError> {
        self.cpu_read_signal(IRQ_INT2_CAUSE)
    }

    /// ビット線とデータバイトを初期化する。
    pub fn reset(&mut self) {
        self.bits.clear();
        self.out_data_byte = 0;
        self.in_data_byte = 0;
    }

    /// 現在状態のスナップショット。
    pub fn snapshot(&self) -> Tms9995CruHandshakeSnapshot {
        let mut bits = HashMap::new();
        for bit in BIT_MIN..=BIT_MAX {
            bits.insert(fmt_bit_addr(bit), *self.bits.get(&bit).unwrap_or(&0));
        }
        Tms9995CruHandshakeSnapshot {
            cpu_out_signals: Tms9995CruCpuOutSignals {
                hshk_out_req: *self.bits.get(&CPU_OUT_HSHK_OUT_REQ).unwrap_or(&0),
                hshk_out_dena: *self.bits.get(&CPU_OUT_HSHK_OUT_DENA).unwrap_or(&0),
                hshk_in_dack: *self.bits.get(&CPU_OUT_HSHK_IN_DACK).unwrap_or(&0),
                interrupt_busy: *self.bits.get(&IRQ_INTERRUPT_BUSY).unwrap_or(&0),
            },
            cpu_in_signals: Tms9995CruCpuInSignals {
                hshk_in_req: *self.bits.get(&CPU_IN_HSHK_IN_REQ).unwrap_or(&0),
                hshk_in_dena: *self.bits.get(&CPU_IN_HSHK_IN_DENA).unwrap_or(&0),
                hshk_out_dack: *self.bits.get(&CPU_IN_HSHK_OUT_DACK).unwrap_or(&0),
                int1_cause: *self.bits.get(&IRQ_INT1_CAUSE).unwrap_or(&0),
                int2_cause: *self.bits.get(&IRQ_INT2_CAUSE).unwrap_or(&0),
            },
            out_data_byte: self.out_data_byte,
            in_data_byte: self.in_data_byte,
            bits,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CruCpuOutSignals {
    pub hshk_out_req: u8,
    pub hshk_out_dena: u8,
    pub hshk_in_dack: u8,
    pub interrupt_busy: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CruCpuInSignals {
    pub hshk_in_req: u8,
    pub hshk_in_dena: u8,
    pub hshk_out_dack: u8,
    pub int1_cause: u8,
    pub int2_cause: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CruHandshakeSnapshot {
    pub cpu_out_signals: Tms9995CruCpuOutSignals,
    pub cpu_in_signals: Tms9995CruCpuInSignals,
    pub out_data_byte: u8,
    pub in_data_byte: u8,
    pub bits: HashMap<String, u8>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_to_io_signal_path() {
        let mut cru = Tms9995CruHandshakeMock::default();
        cru.cpu_write_signal(CPU_OUT_HSHK_OUT_REQ, 1).expect("write");
        cru.cpu_write_signal(CPU_OUT_HSHK_OUT_DENA, 1).expect("write");
        cru.cpu_write_out_data_byte(0xa5).expect("data");
        assert_eq!(cru.io_read_signal(CPU_OUT_HSHK_OUT_REQ).expect("read"), 1);
        assert_eq!(cru.io_read_signal(CPU_OUT_HSHK_OUT_DENA).expect("read"), 1);
        assert_eq!(cru.io_read_out_data_byte(), 0xa5);
    }

    #[test]
    fn strict_roles_rejects_wrong_actor() {
        let mut cru = Tms9995CruHandshakeMock::default();
        assert!(cru
            .write_bit(Tms9995CruActor::Cpu, CPU_IN_HSHK_IN_REQ, 1)
            .is_err());
        assert!(cru
            .write_bit(Tms9995CruActor::Io, CPU_OUT_HSHK_OUT_REQ, 1)
            .is_err());
    }
}
