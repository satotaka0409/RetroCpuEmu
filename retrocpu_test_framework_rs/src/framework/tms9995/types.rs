#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995StackWord {
    pub byte_addr: u16,
    pub value: u16,
    pub arg_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tms9995ArgLocation {
    Register {
        arg_index: usize,
        reg: u8,
        value: u16,
    },
    Stack {
        arg_index: usize,
        byte_addr: u16,
        value: u16,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Tms9995CallDiagnostics {
    pub forbidden_arg_registers: Vec<u8>,
    pub duplicated_arg_registers: Vec<u8>,
    pub out_of_range_arg_registers: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CallPlan {
    pub registers: [u16; 16],
    pub sp_before_push: u16,
    pub sp_after_push: u16,
    pub stack_words: Vec<Tms9995StackWord>,
    pub arg_locations: Vec<Tms9995ArgLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Tms9995CallPlanOptions {
    pub args: Vec<u16>,
    pub stack_init: Option<u16>,
    pub return_addr: Option<u16>,
    pub arg_registers: Option<Vec<u8>>,
    pub allow_special_purpose_registers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdbSymbol {
    pub name: String,
    pub byte_addr: u32,
    pub word_addr: u32,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdbCheckpoint {
    pub id: String,
    pub name: String,
    pub serial: String,
    pub byte_addr: u32,
    pub word_addr: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CdbTable {
    pub by_name: std::collections::HashMap<String, CdbSymbol>,
    pub symbols: Vec<CdbSymbol>,
    pub checkpoints: Vec<CdbCheckpoint>,
}

/// `call` 前に上書きするレジスタ（`None` は plan／現値維持）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Tms9995CallRegisters {
    pub r: [Option<u16>; 16],
}

/// TMS9995 サブルーチン呼び出しオプション。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CallOptions {
    pub registers: Option<Tms9995CallRegisters>,
    pub args: Vec<u16>,
    pub stack_init: Option<u16>,
    pub workspace: Option<u16>,
    pub reset_cpu: bool,
}

impl Default for Tms9995CallOptions {
    fn default() -> Self {
        Self {
            registers: None,
            args: Vec::new(),
            stack_init: None,
            workspace: None,
            reset_cpu: false,
        }
    }
}

/// `call` 完了後の CPU スナップショット。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995CallResult {
    pub registers: [u16; 16],
    pub wp: u16,
    pub pc: u16,
    pub st: u16,
    pub pre_call_sp: u16,
}
