//! assembleAndLink 統合テスト（fixture + sdld）。
//!
//! 根拠: `retrocpu_test_framework_ts/test/assemble_link.unit.ts`

use std::fs;
use std::path::PathBuf;

use retrocpu_test_framework_rs::{
    assemble_and_link, assemble_to_hex_cdb, find_sdld, lookup_byte_addr,
    parse_cdb, sources_have_main, AsmCpuType, AsmSource, AssembleLinkOptions,
    AssembleToFilesOptions, FrameworkError,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn fixture(name: &str) -> PathBuf {
    fixtures_dir().join(name)
}

fn sdld_available() -> bool {
    find_sdld().is_ok()
}

#[test]
fn main_stub_places_code_at_0x0200_without_main() -> Result<(), FrameworkError> {
    if !sdld_available() {
        eprintln!("skip: sdld not found");
        return Ok(());
    }
    let linked = assemble_and_link(AssembleLinkOptions {
        cpu: AsmCpuType::Mn1613,
        sources: vec![AsmSource::File {
            file: fixture("lib.asm"),
            module: None,
        }],
        code_org_word: None,
    })?;
    assert!(*linked.globals.get("GL_LIB_ENTRY").unwrap_or(&0) >= 0x0200);
    assert_eq!(linked.globals.get("__TEST_FRAME_MAIN"), Some(&0x0200));
    Ok(())
}

#[test]
fn main_with_lib_writes_hex_cdb() -> Result<(), FrameworkError> {
    if !sdld_available() {
        eprintln!("skip: sdld not found");
        return Ok(());
    }
    let out = tempfile::tempdir().expect("tempdir");
    let hex_file = out.path().join("assemble_link_fix.ihx");
    let cdb_file = out.path().join("assemble_link_fix.cdb");
    let linked = assemble_to_hex_cdb(AssembleToFilesOptions {
        link: AssembleLinkOptions {
            cpu: AsmCpuType::Mn1613,
            sources: vec![
                AsmSource::File {
                    file: fixture("main.asm"),
                    module: Some("MAIN".into()),
                },
                AsmSource::File {
                    file: fixture("lib.asm"),
                    module: None,
                },
            ],
            code_org_word: None,
        },
        hex_file: hex_file.clone(),
        cdb_file: cdb_file.clone(),
    })?;
    assert!(linked.globals.contains_key("GL_MAIN"));
    assert!(linked.globals.contains_key("GL_LIB_ENTRY"));
    assert!(hex_file.is_file());
    assert!(cdb_file.is_file());
    let cdb = parse_cdb(&fs::read_to_string(&cdb_file).expect("read cdb")).expect("parse cdb");
    let main = cdb.by_name.get("GL_MAIN").expect("GL_MAIN");
    assert_eq!(main.byte_addr % 2, 0);
    assert_eq!(
        main.word_addr,
        *linked.globals.get("GL_MAIN").expect("GL_MAIN word")
    );
    assert!(fs::read_to_string(&hex_file)
        .expect("read hex")
        .contains(":00000001FF"));
    Ok(())
}

#[test]
fn tms9995_no_main_stub() -> Result<(), FrameworkError> {
    if !sdld_available() {
        eprintln!("skip: sdld not found");
        return Ok(());
    }
    let linked = assemble_and_link(AssembleLinkOptions {
        cpu: AsmCpuType::Tms9995,
        sources: vec![AsmSource::Text {
            text: [
                "\t.cpu\ttms9995",
                "\t.area\t_CODE\t\t(REL,CON)",
                "\t.global\tGL_TMS_ENTRY",
                "GL_TMS_ENTRY:",
                "\tnop",
                "",
            ]
            .join("\n"),
            module: "LIBTMS".into(),
            from_dir: None,
        }],
        code_org_word: None,
    })?;
    assert_eq!(linked.cpu, AsmCpuType::Tms9995);
    assert!(!linked.globals.contains_key("__TEST_FRAME_MAIN"));
    assert_eq!(lookup_byte_addr(&linked, "GL_TMS_ENTRY").expect("byte"), 0);
    Ok(())
}

#[test]
fn sources_have_main_detects_main_module() {
    assert!(sources_have_main(&[AsmSource::File {
        file: fixture("main.asm"),
        module: Some("MAIN".into()),
    }]));
}
