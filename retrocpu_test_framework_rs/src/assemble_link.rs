//! `.asm` をアセンブルし sdld でリンクする。
//!
//! 根拠: `retrocpu_test_framework_ts/src/assemble_link.ts`

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use retrocpu_asm_rs::{assemble, expand_includes_from_file, write_rel, CpuType};
use tempfile::TempDir;

use crate::checkpoint::{
    checkpoint_id, checkpoints_to_cdb, create_checkpoint_state, inject_checkpoints,
    is_synthetic_checkpoint_global,
};
use crate::error::FrameworkError;
use crate::expand_includes;
use crate::hex_cdb::{defs_to_cdb, image_to_intel_hex};
use crate::mn1613::main_stub::{mn1613_default_code_org_word, mn1613_main_stub};
use crate::repo::framework_build;
use crate::sdld_link::link_rels_with_sdld;
use crate::types::{
    AsmCpuType, AsmSource, AssembleLinkOptions, AssembleToFilesOptions, AssembledModule,
    LinkedCheckpoint, LinkedImage,
};

const CP_CDB_LINE: &str =
    r"^L:(?:G\$)?(__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})):([0-9A-Fa-f]+)$";

fn resolve_module_name(source: &AsmSource) -> String {
    match source {
        AsmSource::Text { module, .. } => module.to_ascii_uppercase(),
        AsmSource::File { module, file } => module
            .clone()
            .unwrap_or_else(|| {
                file.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("MOD")
                    .to_string()
            })
            .to_ascii_uppercase(),
    }
}

/// ソース列に MAIN モジュールが含まれるか。
pub fn sources_have_main(sources: &[AsmSource]) -> bool {
    sources.iter().any(|s| resolve_module_name(s) == "MAIN")
}

fn to_asm_cpu(cpu: AsmCpuType) -> CpuType {
    match cpu {
        AsmCpuType::Mn1613 => CpuType::Mn1613,
        AsmCpuType::Tms9995 => CpuType::Tms9995,
    }
}

fn parse_checkpoints_from_cdb(cdb_text: &str) -> Vec<LinkedCheckpoint> {
    let re = regex::Regex::new(CP_CDB_LINE).unwrap();
    let mut out = Vec::new();
    for raw in cdb_text.replace("\r\n", "\n").lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let Some(cap) = re.captures(line) else {
            continue;
        };
        let name = cap.get(2).unwrap().as_str().to_string();
        let serial = cap.get(3).unwrap().as_str().to_string();
        let byte_addr = u32::from_str_radix(cap.get(4).unwrap().as_str(), 16).unwrap_or(0);
        out.push(LinkedCheckpoint {
            name: name.clone(),
            serial: serial.clone(),
            id: checkpoint_id(&name, &serial),
            byte_addr,
            word_addr: byte_addr >> 1,
        });
    }
    out
}

fn expand_source(source: &AsmSource) -> Result<(String, String), FrameworkError> {
    match source {
        AsmSource::File { file, .. } => {
            let text = expand_includes_from_file(file.as_path(), None).map_err(|e| {
                FrameworkError::invalid_argument(format!("expand {}: {e}", file.display()))
            })?;
            Ok((text, file.display().to_string()))
        }
        AsmSource::Text {
            text,
            module,
            from_dir,
        } => {
            let base = from_dir
                .clone()
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            let expanded = expand_includes(text, base.as_path(), None)?;
            Ok((expanded, format!("<inline:{module}>")))
        }
    }
}

/// `.asm` をアセンブルし sdld でリンクしてイメージ・HEX・CDB を返す。
pub fn assemble_and_link(options: AssembleLinkOptions) -> Result<LinkedImage, FrameworkError> {
    let cpu = options.cpu;
    let has_main = sources_have_main(&options.sources);
    let code_org_word = options
        .code_org_word
        .unwrap_or_else(|| mn1613_default_code_org_word(cpu, has_main));

    let work_dir = TempDir::new().map_err(|e| {
        FrameworkError::invalid_argument(format!("tempdir failed: {e}"))
    })?;
    let work_path = work_dir.path();
    let mut rel_paths: Vec<PathBuf> = Vec::new();
    let mut modules: Vec<AssembledModule> = Vec::new();
    let mut cp_state = create_checkpoint_state();

    let mut add_module =
        |source_text: &str, module_name: &str, source_path: &str| -> Result<(), FrameworkError> {
            let injected = inject_checkpoints(source_text, &mut cp_state)?;
            let result = assemble(&injected, Some(to_asm_cpu(cpu))).map_err(|e| {
                FrameworkError::invalid_argument(format!("assemble {module_name}: {e}"))
            })?;
            let rel_text = write_rel(&result, module_name);
            let rel_path = work_path.join(format!("{module_name}.rel"));
            fs::write(&rel_path, rel_text).map_err(|e| {
                FrameworkError::invalid_argument(format!("write rel {}: {e}", rel_path.display()))
            })?;
            rel_paths.push(rel_path);
            modules.push(AssembledModule {
                module: module_name.to_string(),
                source_path: source_path.to_string(),
                symbols: result.symbols,
            });
            Ok(())
        };

    if code_org_word > 0 {
        add_module(
            &mn1613_main_stub(code_org_word, cpu),
            "MAIN",
            "<test_frame_main>",
        )?;
    }

    let mut sources = options.sources.clone();
    if let Some(idx) = sources
        .iter()
        .position(|s| resolve_module_name(s) == "MAIN")
    {
        if idx > 0 {
            let main_src = sources.remove(idx);
            sources.insert(0, main_src);
        }
    }

    for source in &sources {
        let module_name = resolve_module_name(source);
        let (source_text, source_path) = expand_source(source)?;
        add_module(&source_text, &module_name, &source_path)?;
    }

    let linked = link_rels_with_sdld(
        &rel_paths,
        cpu == AsmCpuType::Mn1613,
        work_path,
        "out",
    )?;

    let mut globals = HashMap::new();
    let mut global_bytes = HashMap::new();
    for (name, byte_addr) in &linked.defs {
        if is_synthetic_checkpoint_global(name) {
            continue;
        }
        if name.to_ascii_uppercase().starts_with("__CP$") {
            continue;
        }
        let key = name.to_ascii_uppercase();
        global_bytes.insert(key.clone(), *byte_addr);
        globals.insert(key, byte_addr >> 1);
    }

    let checkpoints = parse_checkpoints_from_cdb(&linked.cdb_text);
    let mut cdb_text = if linked.cdb_text.is_empty() {
        defs_to_cdb(&linked.defs)
    } else {
        linked.cdb_text.clone()
    };
    if !cp_state.emitted.is_empty() {
        cdb_text.push_str(&checkpoints_to_cdb(&cp_state.emitted, &linked.defs)?);
    }
    let checkpoints = if checkpoints.is_empty() && !cp_state.emitted.is_empty() {
        parse_checkpoints_from_cdb(&cdb_text)
    } else {
        checkpoints
    };
    let hex_text = if linked.hex_text.is_empty() {
        image_to_intel_hex(&linked.image)
    } else {
        linked.hex_text
    };

    Ok(LinkedImage {
        cpu,
        image: linked.image,
        globals,
        global_bytes,
        hex_text,
        cdb_text,
        modules,
        checkpoints,
    })
}

/// アセンブル／リンクし Intel HEX と CDB をファイルへ書く。
pub fn assemble_to_hex_cdb(options: AssembleToFilesOptions) -> Result<LinkedImage, FrameworkError> {
    let linked = assemble_and_link(options.link)?;
    let hex_file = &options.hex_file;
    let cdb_file = &options.cdb_file;
    if let Some(parent) = hex_file.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            FrameworkError::invalid_argument(format!("mkdir {}: {e}", parent.display()))
        })?;
    }
    if let Some(parent) = cdb_file.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            FrameworkError::invalid_argument(format!("mkdir {}: {e}", parent.display()))
        })?;
    }
    fs::write(hex_file, &linked.hex_text).map_err(|e| {
        FrameworkError::invalid_argument(format!("write hex {}: {e}", hex_file.display()))
    })?;
    fs::write(cdb_file, &linked.cdb_text).map_err(|e| {
        FrameworkError::invalid_argument(format!("write cdb {}: {e}", cdb_file.display()))
    })?;
    Ok(linked)
}

/// セッション用の既定 HEX / CDB パス。
pub fn default_hex_cdb_paths() -> HexCdbPaths {
    let build = framework_build();
    HexCdbPaths {
        hex_file: build.join("session.ihx"),
        cdb_file: build.join("session.cdb"),
    }
}

/// 既定 HEX/CDB パス。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HexCdbPaths {
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
}

/// リンク済みグローバルのワードアドレスを探す（MN1613）。
pub fn lookup_word_addr(image: &LinkedImage, name: &str) -> Result<u32, FrameworkError> {
    if image.cpu != AsmCpuType::Mn1613 {
        return Err(FrameworkError::invalid_argument(format!(
            "lookup_word_addr is MN1613-only (symbol: {name})"
        )));
    }
    let key = name.to_ascii_uppercase();
    image
        .globals
        .get(&key)
        .copied()
        .ok_or_else(|| FrameworkError::invalid_argument(format!("Global symbol not found: {name}")))
}

/// リンク済みグローバルのバイトアドレスを探す。
pub fn lookup_byte_addr(image: &LinkedImage, name: &str) -> Result<u32, FrameworkError> {
    let key = name.to_ascii_uppercase();
    image
        .global_bytes
        .get(&key)
        .copied()
        .ok_or_else(|| FrameworkError::invalid_argument(format!("Global symbol not found: {name}")))
}
