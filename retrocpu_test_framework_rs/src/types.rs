#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsmCpuType {
    Mn1613,
    Tms9995,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpuLogMode {
    Checkpoint,
    Instruction,
}
