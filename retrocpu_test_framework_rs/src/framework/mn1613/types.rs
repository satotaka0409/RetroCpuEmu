use std::collections::HashMap;
use std::path::PathBuf;

use crate::json_value::CodeTestIoMockEntry;
use crate::types::CpuLogMode;

/// call 前後で指定できるレジスタ（部分指定）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CallRegisters {
    pub r0: Option<u16>,
    pub r1: Option<u16>,
    pub r2: Option<u16>,
    pub r3: Option<u16>,
    pub r4: Option<u16>,
    pub sp: Option<u16>,
    pub str_reg: Option<u16>,
    pub csbr: Option<u16>,
    pub ssbr: Option<u16>,
    pub tsr0: Option<u16>,
    pub tsr1: Option<u16>,
    pub ic: Option<u16>,
    pub iisr: Option<u16>,
    pub npp: Option<u8>,
    pub osr: Option<[u8; 4]>,
}

/// サブルーチン呼び出しオプション。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CallOptions {
    pub registers: Option<CallRegisters>,
    pub stack: Option<Vec<u16>>,
    pub call_mode: Option<CallMode>,
    pub reset_cpu: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallMode {
    Bal,
    Balr,
}

/// call 停止時のレジスタ。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallResultRegisters {
    pub r: [u16; 5],
    pub sp: u16,
    pub str_reg: u16,
    pub ic: u16,
    pub csbr: u16,
    pub ssbr: u16,
    pub iisr: u16,
}

/// call の戻り値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallResult {
    pub registers: CallResultRegisters,
    pub pre_call_sp: u16,
    pub entry_word_addr: u16,
}

/// スタックワーク検証指定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StackWorkExpect {
    pub offset: i32,
    pub words: Vec<u16>,
}

/// セッション生成オプション。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mn1613SessionOptions {
    pub hex_file: Option<PathBuf>,
    pub cdb_file: Option<PathBuf>,
    pub init_label: Option<Option<String>>,
    pub stack_init: Option<u16>,
    pub return_stub_word_addr: Option<u16>,
    pub max_cycles: Option<u64>,
    pub memory_bytes: Option<usize>,
    pub io_mock: Option<Vec<CodeTestIoMockEntry>>,
    pub cpu_log_file: Option<PathBuf>,
    pub cpu_log_mode: Option<CpuLogMode>,
}

impl Default for Mn1613SessionOptions {
    fn default() -> Self {
        Self {
            hex_file: None,
            cdb_file: None,
            init_label: None,
            stack_init: None,
            return_stub_word_addr: None,
            max_cycles: None,
            memory_bytes: None,
            io_mock: None,
            cpu_log_file: None,
            cpu_log_mode: None,
        }
    }
}

/// レジスタ期待値（部分指定）。
pub type RegisterExpect = CallRegisters;

/// ポート固定読取設定。
#[derive(Debug, Clone, Default)]
pub struct PortMockState {
    pub reads: HashMap<u16, u16>,
    pub write_log: Vec<(u16, u16)>,
}
