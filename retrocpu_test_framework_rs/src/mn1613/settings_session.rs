use std::path::{Path, PathBuf};

use crate::error::FrameworkError;
use crate::json_suite::resolve_suite_path;
use crate::json_value::{CodeTestIoMockEntry, JsonTestSettings};
use crate::mn1613::session::{create_mn1613_asm_session, Mn1613AsmSession};
use crate::mn1613::types::Mn1613SessionOptions;
use crate::types::{AsmCpuType, CpuLogMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTestSettings {
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
    pub init_label: Option<String>,
    pub cpu: AsmCpuType,
    pub io_mock: Option<Vec<CodeTestIoMockEntry>>,
    pub cpu_log_file: Option<PathBuf>,
    pub cpu_log_mode: Option<CpuLogMode>,
    pub max_cycles: Option<u64>,
}

pub fn resolve_test_settings(
    settings: &JsonTestSettings,
    from_dir: Option<&Path>,
) -> Result<ResolvedTestSettings, FrameworkError> {
    let cwd = std::env::current_dir()
        .map_err(|e| FrameworkError::invalid_argument(format!("failed to get cwd: {e}")))?;
    let base = from_dir.unwrap_or(cwd.as_path());

    let hex_file = resolve_suite_path(&settings.hex_file, base)?;
    let cdb_file = resolve_suite_path(&settings.cdb_file, base)?;
    let cpu_log_file = match &settings.cpu_log_file {
        Some(v) if !v.is_empty() => Some(resolve_suite_path(v, base)?),
        _ => None,
    };

    Ok(ResolvedTestSettings {
        hex_file,
        cdb_file,
        init_label: settings.init_label.clone(),
        cpu: settings.cpu,
        io_mock: settings.io_mock.clone(),
        cpu_log_file,
        cpu_log_mode: settings.cpu_log_mode,
        max_cycles: settings.max_cycles,
    })
}

pub fn create_session_from_settings(
    settings: &JsonTestSettings,
    from_dir: Option<&Path>,
) -> Result<Mn1613AsmSession, FrameworkError> {
    let resolved = resolve_test_settings(settings, from_dir)?;
    if resolved.cpu != AsmCpuType::Mn1613 {
        return Err(FrameworkError::invalid_argument(format!(
            "create_session_from_settings currently supports mn1613 runtime only (got: {:?}). For tms9995 use create_tms9995_session_from_settings.",
            resolved.cpu
        )));
    }
    create_mn1613_asm_session(Mn1613SessionOptions {
        hex_file: Some(resolved.hex_file),
        cdb_file: Some(resolved.cdb_file),
        init_label: Some(resolved.init_label),
        io_mock: resolved.io_mock,
        cpu_log_file: resolved.cpu_log_file,
        cpu_log_mode: resolved.cpu_log_mode,
        max_cycles: resolved.max_cycles,
        ..Default::default()
    })
}
