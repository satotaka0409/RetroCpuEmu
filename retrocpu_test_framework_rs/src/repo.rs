use std::path::PathBuf;

pub fn framework_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn repo_root() -> PathBuf {
    framework_root()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(framework_root)
}

pub fn framework_build() -> PathBuf {
    framework_root().join("build")
}

pub fn asm_dist() -> PathBuf {
    repo_root().join("retrocpu_asm").join("dist").join("main")
}

pub fn monitor_src() -> PathBuf {
    repo_root()
        .join("retrocpu_boot_monitor")
        .join("src")
        .join("mn1613")
}

pub fn monitor_hex() -> PathBuf {
    repo_root()
        .join("retrocpu_boot_monitor")
        .join("build")
        .join("hex")
        .join("mn1613")
}

pub fn monitor_test() -> PathBuf {
    repo_root()
        .join("retrocpu_boot_monitor")
        .join("test")
        .join("mn1613")
}

pub fn repo_path(rel: &[&str]) -> PathBuf {
    let mut p = repo_root();
    for s in rel {
        p.push(s);
    }
    p
}
