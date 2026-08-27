use std::path::{Path, PathBuf};

use crate::error::FrameworkError;
use crate::json_suite::resolve_suite_path;
use crate::json_value::{CodeTestIoMockEntry, JsonTestSettings};
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
) -> Result<ResolvedTestSettings, FrameworkError> {
    let resolved = resolve_test_settings(settings, from_dir)?;
    if resolved.cpu != AsmCpuType::Mn1613 {
        return Err(FrameworkError::invalid_argument(format!(
            "create_session_from_settings currently supports mn1613 runtime only (got: {:?}). For tms9995 use create_tms9995_session_from_settings.",
            resolved.cpu
        )));
    }

    Err(FrameworkError::not_implemented(
        "Mn1613AsmSession runtime is not implemented in retrocpu_test_framework_rs yet",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_settings(hex_file: String, cdb_file: String) -> JsonTestSettings {
        JsonTestSettings {
            name: "t".to_string(),
            cpu: AsmCpuType::Mn1613,
            hex_file,
            cdb_file,
            init_label: Some("g_main".to_string()),
            io_mock: None,
            cpu_log_file: None,
            cpu_log_mode: None,
            max_cycles: None,
        }
    }

    #[test]
    fn resolves_paths_from_base_dir() {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "tf-rs-mn-settings-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create dir");

        let hex = dir.join("a.ihx");
        let cdb = dir.join("a.cdb");
        std::fs::write(&hex, b":00000001FF\n").expect("hex write");
        std::fs::write(&cdb, b"\n").expect("cdb write");

        let s = mk_settings("a.ihx".to_string(), "a.cdb".to_string());
        let r = resolve_test_settings(&s, Some(&dir)).expect("resolve");
        assert_eq!(r.hex_file, hex);
        assert_eq!(r.cdb_file, cdb);

        let _ = std::fs::remove_file(r.hex_file);
        let _ = std::fs::remove_file(r.cdb_file);
        let _ = std::fs::remove_dir_all(dir);
    }
}
