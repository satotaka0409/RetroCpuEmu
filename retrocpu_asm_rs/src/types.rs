use std::collections::HashMap;

use crate::cpu_type::CpuType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLine {
    pub line_no: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLine {
    pub line_no: usize,
    pub text: String,
    pub label: Option<String>,
    pub op: Option<String>,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedWord {
    pub address: u16,
    pub value: u16,
    pub line_no: usize,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressUnit {
    Word,
    Byte,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssemblyResult {
    pub words: Vec<EmittedWord>,
    pub symbols: HashMap<String, u16>,
    pub source_lines: Vec<SourceLine>,
    pub cpu_type: CpuType,
    pub address_unit: AddressUnit,
}
