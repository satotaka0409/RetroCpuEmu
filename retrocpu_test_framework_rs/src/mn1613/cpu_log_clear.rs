use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuLogClearResult {
    pub dir: PathBuf,
    pub deleted: usize,
}

fn normalize_path(input: &str) -> String {
    input.replace('\\', "/")
}

fn find_root_before_segment(normalized: &str, segment: &str) -> Option<String> {
    let idx = normalized.find(segment)?;
    let tail = &normalized[idx + segment.len()..];
    if !tail.is_empty() && !tail.starts_with('/') {
        return None;
    }
    Some(normalized[..idx].to_string())
}

pub fn mn1613_logs_dir_from_test_file(test_file: &str) -> Option<PathBuf> {
    let n = normalize_path(test_file);
    if let Some(root) = find_root_before_segment(&n, "/test/mn1613") {
        return Some(PathBuf::from(format!("{root}/logs/mn1613")));
    }
    if let Some(root) = find_root_before_segment(&n, "/mn1613/test") {
        return Some(PathBuf::from(format!("{root}/logs/mn1613")));
    }
    None
}

pub fn tms9995_logs_dir_from_test_file(test_file: &str) -> Option<PathBuf> {
    let n = normalize_path(test_file);
    find_root_before_segment(&n, "/test/tms9995")
        .map(|root| PathBuf::from(format!("{root}/logs/tms9995")))
}

pub fn clear_cpu_log_dir(dir: &Path) -> usize {
    if !dir.is_dir() {
        return 0;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };

    let mut deleted = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("log") {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    deleted
}

pub fn clear_cpu_logs_before_run(test_files: &[String]) -> Vec<CpuLogClearResult> {
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for f in test_files {
        if let Some(mn) = mn1613_logs_dir_from_test_file(f) {
            dirs.insert(mn);
        }
        if let Some(tms) = tms9995_logs_dir_from_test_file(f) {
            dirs.insert(tms);
        }
    }

    let mut out = Vec::with_capacity(dirs.len());
    for dir in dirs {
        let deleted = clear_cpu_log_dir(&dir);
        out.push(CpuLogClearResult { dir, deleted });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_mn1613_logs_dir_modern_and_legacy() {
        let modern = mn1613_logs_dir_from_test_file("/repo/test/mn1613/a_test.ts")
            .expect("modern path should resolve");
        assert_eq!(modern, PathBuf::from("/repo/logs/mn1613"));

        let legacy = mn1613_logs_dir_from_test_file("/repo/mn1613/test/a_test.ts")
            .expect("legacy path should resolve");
        assert_eq!(legacy, PathBuf::from("/repo/logs/mn1613"));

        assert!(mn1613_logs_dir_from_test_file("/repo/test/other/a_test.ts").is_none());
    }

    #[test]
    fn resolve_tms9995_logs_dir() {
        let dir = tms9995_logs_dir_from_test_file("/repo/test/tms9995/x_test.ts")
            .expect("tms path should resolve");
        assert_eq!(dir, PathBuf::from("/repo/logs/tms9995"));
    }

    #[test]
    fn clear_dir_deletes_only_log_files() {
        let mut temp = std::env::temp_dir();
        temp.push(format!(
            "tf-rs-log-clear-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&temp).expect("temp dir create");

        fs::write(temp.join("a.log"), b"x").expect("write a.log");
        fs::write(temp.join("b.log"), b"x").expect("write b.log");
        fs::write(temp.join("keep.txt"), b"x").expect("write keep.txt");

        let deleted = clear_cpu_log_dir(&temp);
        assert_eq!(deleted, 2);
        assert!(!temp.join("a.log").exists());
        assert!(!temp.join("b.log").exists());
        assert!(temp.join("keep.txt").exists());

        let _ = fs::remove_file(temp.join("keep.txt"));
        let _ = fs::remove_dir_all(&temp);
    }
}
