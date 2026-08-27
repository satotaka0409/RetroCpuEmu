use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::FrameworkError;
use crate::repo::{framework_build, monitor_hex, monitor_src, repo_root};

fn placeholders() -> HashMap<&'static str, String> {
    HashMap::from([
        ("MONITOR_SRC", monitor_src().to_string_lossy().to_string()),
        ("MONITOR_HEX", monitor_hex().to_string_lossy().to_string()),
        (
            "FRAMEWORK_BUILD",
            framework_build().to_string_lossy().to_string(),
        ),
        ("REPO_ROOT", repo_root().to_string_lossy().to_string()),
    ])
}

pub fn expand_placeholders(text: &str) -> Result<String, FrameworkError> {
    let table = placeholders();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while let Some(start_rel) = text[i..].find("${") {
        let start = i + start_rel;
        out.push_str(&text[i..start]);

        let Some(end_rel) = text[start + 2..].find('}') else {
            return Err(FrameworkError::invalid_argument(
                "placeholder missing closing }".to_string(),
            ));
        };
        let end = start + 2 + end_rel;
        let key = &text[start + 2..end];

        let Some(value) = table.get(key) else {
            return Err(FrameworkError::invalid_argument(format!(
                "Unknown placeholder ${{{key}}}"
            )));
        };
        out.push_str(value);
        i = end + 1;
    }

    out.push_str(&text[i..]);
    Ok(out)
}

pub fn resolve_suite_path(spec: &str, from_dir: &Path) -> Result<PathBuf, FrameworkError> {
    let expanded = expand_placeholders(spec)?;
    let p = PathBuf::from(&expanded);
    if p.is_absolute() {
        return Ok(p);
    }

    let from_here = from_dir.join(&p);
    if from_here.exists() {
        return Ok(from_here);
    }

    let from_repo = repo_root().join(&p);
    if from_repo.exists() {
        return Ok(from_repo);
    }

    Ok(from_here)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_known_placeholder() {
        let s = expand_placeholders("${REPO_ROOT}/abc").expect("expand should work");
        assert!(s.ends_with("/abc"));
    }

    #[test]
    fn rejects_unknown_placeholder() {
        let err = expand_placeholders("${UNKNOWN}").expect_err("unknown should fail");
        assert!(format!("{err}").contains("Unknown placeholder"));
    }

    #[test]
    fn resolve_prefers_from_dir_if_exists() {
        let mut tmp = std::env::temp_dir();
        tmp.push(format!(
            "tf-rs-json-suite-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("tmp create");
        let file = tmp.join("x.json");
        std::fs::write(&file, b"{}\n").expect("write");

        let resolved = resolve_suite_path("x.json", &tmp).expect("resolve");
        assert_eq!(resolved, file);

        let _ = std::fs::remove_file(file);
        let _ = std::fs::remove_dir_all(tmp);
    }
}
