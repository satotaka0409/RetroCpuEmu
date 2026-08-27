use crate::types::{AsmCpuType, CpuLogMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodeTestIoMockEntry {
    Handshake,
    PortRead { port: u16, value: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonTestSettings {
    pub name: String,
    pub cpu: AsmCpuType,
    pub hex_file: String,
    pub cdb_file: String,
    pub init_label: Option<String>,
    pub io_mock: Option<Vec<CodeTestIoMockEntry>>,
    pub cpu_log_file: Option<String>,
    pub cpu_log_mode: Option<CpuLogMode>,
    pub max_cycles: Option<u64>,
}
