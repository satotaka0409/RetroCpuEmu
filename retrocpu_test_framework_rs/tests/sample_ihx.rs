//! MN1613: sample.asm の 1..10 総和サブルーチンの E2E サンプル。

use std::fs;
use std::path::PathBuf;

use retrocpu_test_framework_rs::{
    assemble_to_hex_cdb, create_mn1613_asm_session, find_sdld, parse_cdb, AsmCpuType, AsmSource,
    AssembleLinkOptions, AssembleToFilesOptions, CallOptions, CpuLogMode, FrameworkError,
    Mn1613SessionOptions, RegisterExpect,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn fixture(name: &str) -> PathBuf {
    fixtures_dir().join(name)
}

fn logs_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("logs")
}

#[test]
fn sample_asm_sum_1_to_10_e2e() -> Result<(), FrameworkError> {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return Ok(());
    }

    // 1) sample.asm をアセンブル＋リンクして ihx/cdb を作る
    let out = tempfile::tempdir().expect("tempdir");
    let hex_file = out.path().join("sample.ihx");
    let cdb_file = out.path().join("sample.cdb");
    let linked = assemble_to_hex_cdb(AssembleToFilesOptions {
        link: AssembleLinkOptions {
            cpu: AsmCpuType::Mn1613,
            sources: vec![AsmSource::File {
                file: fixture("sample.asm"),
                module: Some("MAIN".into()),
            }],
            code_org_word: None,
        },
        hex_file: hex_file.clone(),
        cdb_file: cdb_file.clone(),
    })?;

    assert!(hex_file.is_file());
    assert!(cdb_file.is_file());
    assert!(linked.globals.contains_key("GL_MAIN"));
    assert!(linked.globals.contains_key("GL_SUM_1_TO_10"));

    // 2) CDB を読み、シンボルが解決できることを確認
    let cdb_text = fs::read_to_string(&cdb_file).expect("read cdb");
    let cdb = parse_cdb(&cdb_text).expect("parse cdb");
    let sum_entry = cdb.by_name.get("GL_SUM_1_TO_10").expect("sum symbol");
    assert_eq!(
        sum_entry.word_addr,
        *linked.globals.get("GL_SUM_1_TO_10").expect("sum word")
    );

    // 3) ihx + cdb を読み込んでサブルーチンを実行し、結果を検証
    let mut session = create_mn1613_asm_session(Mn1613SessionOptions {
        init_label: Some(Some("GL_MAIN".into())),
        hex_file: Some(hex_file),
        cdb_file: Some(cdb_file),
        ..Default::default()
    })?;

    session.run_init()?;
    session.call("GL_SUM_1_TO_10", CallOptions::default())?;
    session.expect_registers(
        &RegisterExpect {
            r0: Some(55),
            r1: Some(0),
            ..Default::default()
        },
        None,
    )?;

    Ok(())
}

#[test]
fn sample_asm_checkpoint_logs_loop_steps() -> Result<(), FrameworkError> {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return Ok(());
    }

    let out = tempfile::tempdir().expect("tempdir");
    let hex_file = out.path().join("sample.ihx");
    let cdb_file = out.path().join("sample.cdb");
    let log_file = logs_dir().join("sample.cpu.log");
    fs::create_dir_all(logs_dir()).expect("create logs dir");

    assemble_to_hex_cdb(AssembleToFilesOptions {
        link: AssembleLinkOptions {
            cpu: AsmCpuType::Mn1613,
            sources: vec![AsmSource::File {
                file: fixture("sample.asm"),
                module: Some("MAIN".into()),
            }],
            code_org_word: None,
        },
        hex_file: hex_file.clone(),
        cdb_file: cdb_file.clone(),
    })?;

    let mut session = create_mn1613_asm_session(Mn1613SessionOptions {
        init_label: Some(Some("GL_MAIN".into())),
        hex_file: Some(hex_file),
        cdb_file: Some(cdb_file),
        cpu_log_file: Some(log_file.clone()),
        cpu_log_mode: Some(CpuLogMode::Checkpoint),
        ..Default::default()
    })?;

    session.run_init()?;
    session.call("GL_SUM_1_TO_10", CallOptions::default())?;
    session.expect_registers(
        &RegisterExpect {
            r0: Some(55),
            r1: Some(0),
            ..Default::default()
        },
        None,
    )?;

    let text = fs::read_to_string(&log_file).expect("read log");
    assert!(text.contains("# call GL_SUM_1_TO_10"));
    assert!(!text.contains("\tH\t"));

    let enter_before_hits: Vec<&str> = text
        .lines()
        .filter(|ln| ln.contains("\tsum_iter_enter$0001\tbefore\t"))
        .map(|ln| ln.split('\t').nth(5).unwrap_or(""))
        .collect();
    assert_eq!(enter_before_hits.len(), 10);
    for (i, hit) in enter_before_hits.iter().enumerate() {
        assert_eq!(*hit, (i + 1).to_string().as_str());
    }

    let leave_after_hits: Vec<&str> = text
        .lines()
        .filter(|ln| ln.contains("\tsum_iter_leave$0001\tafter\t"))
        .map(|ln| ln.split('\t').nth(5).unwrap_or(""))
        .collect();
    assert_eq!(leave_after_hits.len(), 10);
    for (i, hit) in leave_after_hits.iter().enumerate() {
        assert_eq!(*hit, (i + 1).to_string().as_str());
    }

    let first_enter_before = text
        .lines()
        .find(|ln| ln.contains("\tsum_iter_enter$0001\tbefore\t"))
        .expect("first enter before");
    let first_cols: Vec<&str> = first_enter_before.split('\t').collect();
    assert_eq!(first_cols[6], "A R0, R1");
    assert!(first_cols[7].contains("R0=0000"));
    assert!(first_cols[7].contains("R1=000A"));

    let last_leave_after = text
        .lines()
        .rev()
        .find(|ln| ln.contains("\tsum_iter_leave$0001\tafter\t"))
        .expect("last leave after");
    let last_cols: Vec<&str> = last_leave_after.split('\t').collect();
    assert!(last_cols[6].starts_with("SI R1, #1"));
    assert!(last_cols[7].contains("R0=0037"));
    assert!(last_cols[7].contains("R1=0000"));

    Ok(())
}
