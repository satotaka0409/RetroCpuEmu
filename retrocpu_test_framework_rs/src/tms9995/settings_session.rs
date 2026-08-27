use std::path::Path;

use crate::error::FrameworkError;
use crate::json_suite::resolve_suite_path;
use crate::json_value::JsonTestSettings;
use crate::types::AsmCpuType;

use super::session::{
    create_tms9995_artifact_session, Tms9995ArtifactSession, Tms9995SessionOptions,
};

pub fn create_tms9995_session_from_settings(
    settings: &JsonTestSettings,
    from_dir: Option<&Path>,
) -> Result<Tms9995ArtifactSession, FrameworkError> {
    if settings.cpu != AsmCpuType::Tms9995 {
        return Err(FrameworkError::invalid_argument(format!(
            "create_tms9995_session_from_settings requires cpu Tms9995 (got: {:?})",
            settings.cpu
        )));
    }

    let cwd = std::env::current_dir()
        .map_err(|e| FrameworkError::invalid_argument(format!("failed to get cwd: {e}")))?;
    let base = from_dir.unwrap_or(cwd.as_path());

    let hex_file = resolve_suite_path(&settings.hex_file, base)?;
    let cdb_file = resolve_suite_path(&settings.cdb_file, base)?;

    create_tms9995_artifact_session(Tms9995SessionOptions {
        hex_file,
        cdb_file,
        memory_bytes: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_tms_cpu() {
        let settings = JsonTestSettings {
            name: "t".to_string(),
            cpu: AsmCpuType::Mn1613,
            hex_file: "a.ihx".to_string(),
            cdb_file: "a.cdb".to_string(),
            init_label: None,
            io_mock: None,
            cpu_log_file: None,
            cpu_log_mode: None,
            max_cycles: None,
        };

        let err = create_tms9995_session_from_settings(&settings, None)
            .expect_err("mn cpu must be rejected");
        assert!(format!("{err}").contains("requires cpu Tms9995"));
    }
}
