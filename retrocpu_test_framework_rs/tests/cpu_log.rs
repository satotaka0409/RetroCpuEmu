//! テスト専用 CPU ログ統合テスト。
//!
//! 根拠: `retrocpu_test_framework_ts/test/cpu_log.unit.ts`

use std::fs;

use retrocpu_test_framework_rs::{
    assemble_to_hex_cdb, begin_cpu_log_test, clear_cpu_logs_before_run, create_mn1613_asm_session,
    end_cpu_log_test, find_sdld, mn1613_logs_dir_from_test_file, AsmCpuType, AsmSource,
    AssembleLinkOptions, AssembleToFilesOptions, CallOptions, CallRegisters, CpuLogMode,
    FrameworkError, Mn1613AsmSession, Mn1613SessionOptions, RegisterExpect,
};

const ADD_SRC: &str = "\
\t.cpu\tmn1613
\t.area\t_CODE (REL,CON)
\t.org\t0x0200
\t.globl\tgl_main
\t.globl\tgl_add
gl_main:
\th
gl_add:
; @cp add_enter
\ta\tR0, R1
; @cp add_leave
\tret
";

fn session_from_inline_asm(
    dir: &std::path::Path,
    opts: Mn1613SessionOptions,
) -> Result<Mn1613AsmSession, FrameworkError> {
    if find_sdld().is_err() {
        return Err(FrameworkError::invalid_argument("sdld not found"));
    }
    let hex_file = dir.join("t.ihx");
    let cdb_file = dir.join("t.cdb");
    assemble_to_hex_cdb(AssembleToFilesOptions {
        link: AssembleLinkOptions {
            cpu: AsmCpuType::Mn1613,
            sources: vec![AsmSource::Text {
                text: ADD_SRC.to_string(),
                module: "MAIN".into(),
                from_dir: None,
            }],
            code_org_word: None,
        },
        hex_file: hex_file.clone(),
        cdb_file: cdb_file.clone(),
    })?;
    create_mn1613_asm_session(Mn1613SessionOptions {
        init_label: Some(Some("gl_main".into())),
        hex_file: Some(hex_file),
        cdb_file: Some(cdb_file),
        ..opts
    })
}

#[test]
fn cpu_log_file_unset_does_not_create_log() {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let log_file = dir.path().join("cpu.log");
    let mut session = session_from_inline_asm(
        dir.path(),
        Mn1613SessionOptions {
            cpu_log_file: None,
            ..Default::default()
        },
    )
    .expect("session");
    session.run_init().expect("run_init");
    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    r1: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call");
    session
        .expect_registers(
            &RegisterExpect {
                r0: Some(7),
                ..Default::default()
            },
            None,
        )
        .expect("expect_registers");
    assert!(!log_file.exists());
}

#[test]
fn cpu_log_mode_none_writes_no_body_lines() {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let log_file = dir.path().join("cpu.log");
    let title = "cpu_log_mode_none_writes_no_body_lines";
    begin_cpu_log_test(title);
    let mut session = session_from_inline_asm(
        dir.path(),
        Mn1613SessionOptions {
            cpu_log_file: Some(log_file.clone()),
            cpu_log_mode: None,
            ..Default::default()
        },
    )
    .expect("session");
    session.run_init().expect("run_init");
    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    r1: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call");
    end_cpu_log_test(title);
    let text = fs::read_to_string(&log_file).expect("read log");
    assert!(text.contains(&format!("{title} START")));
    assert!(!text.contains("# runInit"));
    assert_eq!(text.lines().filter(|ln| ln.contains('\t')).count(), 0);
}

#[test]
fn cpu_log_mode_checkpoint_writes_cp_before_after() {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let log_file = dir.path().join("cpu.log");
    let mut session = session_from_inline_asm(
        dir.path(),
        Mn1613SessionOptions {
            cpu_log_file: Some(log_file.clone()),
            cpu_log_mode: Some(CpuLogMode::Checkpoint),
            ..Default::default()
        },
    )
    .expect("session");
    session.run_init().expect("run_init");
    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    r1: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call");
    let text = fs::read_to_string(&log_file).expect("read log");
    assert!(text.contains("# runInit gl_main"));
    assert!(text.contains("# call gl_add"));
    assert!(!text.contains("\tH\t"));

    let recs: Vec<Vec<&str>> = text
        .lines()
        .filter(|ln| ln.contains('\t'))
        .map(|ln| ln.split('\t').collect())
        .collect();
    assert_eq!(recs.len(), 4);
    assert_eq!(recs[0][3], "add_enter$0001");
    assert_eq!(recs[0][4], "before");
    assert_eq!(recs[0][5], "1");
    assert_eq!(recs[0][6], "A R0, R1");
    assert!(recs[0][7].contains("R0=0003"));
    assert_eq!(recs[0][8].split(' ').count(), 16);
    assert_eq!(recs[1][3], "add_enter$0001");
    assert_eq!(recs[1][4], "after");
    assert!(recs[1][7].contains("R0=0007"));
    assert_eq!(recs[2][3], "add_leave$0001");
    assert_eq!(recs[2][4], "before");
    assert_eq!(recs[3][3], "add_leave$0001");
    assert_eq!(recs[3][4], "after");

    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(1),
                    r1: Some(1),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call2");
    let text2 = fs::read_to_string(&log_file).expect("read log2");
    let enter_before_hits: Vec<&str> = text2
        .lines()
        .filter(|ln| ln.contains("\tadd_enter$0001\tbefore\t"))
        .map(|ln| ln.split('\t').nth(5).unwrap_or(""))
        .collect();
    assert_eq!(enter_before_hits, vec!["1", "2"]);

    session.reload().expect("reload");
    session.run_init().expect("run_init2");
    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(2),
                    r1: Some(2),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call3");
    let text3 = fs::read_to_string(&log_file).expect("read log3");
    let after_reload = if let Some(idx) = text3.rfind("# reload") {
        &text3[idx..]
    } else {
        ""
    };
    let hit_after_reload = after_reload
        .lines()
        .find(|ln| ln.contains("\tadd_enter$0001\tbefore\t"))
        .and_then(|ln| ln.split('\t').nth(5));
    assert_eq!(hit_after_reload, Some("1"));
}

#[test]
fn cpu_log_mode_instruction_writes_all_after_only() {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let log_file = dir.path().join("cpu.log");
    let mut session = session_from_inline_asm(
        dir.path(),
        Mn1613SessionOptions {
            cpu_log_file: Some(log_file.clone()),
            cpu_log_mode: Some(CpuLogMode::Instruction),
            ..Default::default()
        },
    )
    .expect("session");
    session.run_init().expect("run_init");
    session
        .call(
            "gl_add",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    r1: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("call");

    let text = fs::read_to_string(&log_file).expect("read log");
    let call_section = text
        .split("# call gl_add")
        .nth(1)
        .unwrap_or("")
        .split("# ")
        .next()
        .unwrap_or("");
    let recs: Vec<Vec<&str>> = call_section
        .lines()
        .filter(|ln| ln.contains('\t'))
        .map(|ln| ln.split('\t').collect())
        .collect();
    assert_eq!(recs.len(), 3);
    assert!(recs.iter().all(|r| r[4] == "after"));
    assert!(!recs.iter().any(|r| r[4] == "before"));
    assert_eq!(recs[0][3], "add_enter$0001");
    assert_eq!(recs[0][6], "A R0, R1");
    assert!(recs[0][7].contains("R0=0007"));
    assert_eq!(recs[1][3], "add_leave$0001");
    assert!(recs[1][6].starts_with("RET"));
    assert_eq!(recs[2][3], "-");
    assert_eq!(recs[2][6], "H");

    let run_init_section = text
        .split("# runInit gl_main")
        .nth(1)
        .unwrap_or("")
        .split("# call")
        .next()
        .unwrap_or("");
    let init_recs: Vec<Vec<&str>> = run_init_section
        .lines()
        .filter(|ln| ln.contains('\t'))
        .map(|ln| ln.split('\t').collect())
        .collect();
    assert!(!init_recs.is_empty());
    assert!(init_recs.iter().all(|r| r[4] == "after"));
    assert!(init_recs.iter().any(|r| r[3] == "-" && r[6] == "H"));
}

#[test]
fn clear_cpu_logs_before_run_deletes_mn1613_logs() {
    let root = tempfile::tempdir().expect("tempdir");
    let test_file = root
        .path()
        .join("test/mn1613/bios/bios_common_test.ts");
    let log_dir = root.path().join("logs/mn1613");
    fs::create_dir_all(test_file.parent().expect("parent")).expect("mkdir test");
    fs::create_dir_all(&log_dir).expect("mkdir logs");
    fs::write(log_dir.join("bios_common.log"), "old\n").expect("write log");
    fs::write(log_dir.join("handshake_timer.log"), "old\n").expect("write timer log");
    fs::write(log_dir.join("keep.txt"), "keep\n").expect("write keep");
    assert_eq!(
        mn1613_logs_dir_from_test_file(&test_file.to_string_lossy()),
        Some(log_dir.clone())
    );
    let cleared = clear_cpu_logs_before_run(&[
        test_file.to_string_lossy().to_string(),
        root.path()
            .join("test/cpu_log.unit.ts")
            .to_string_lossy()
            .to_string(),
    ]);
    assert_eq!(cleared.len(), 1);
    assert!(!log_dir.join("bios_common.log").exists());
    assert!(!log_dir.join("handshake_timer.log").exists());
    assert_eq!(
        fs::read_to_string(log_dir.join("keep.txt")).expect("read keep"),
        "keep\n"
    );
}

#[test]
fn begin_end_cpu_log_test_marks() {
    if find_sdld().is_err() {
        eprintln!("skip: sdld not found");
        return;
    }
    let dir = tempfile::tempdir().expect("tempdir");
    let log_file = dir.path().join("cpu.log");
    let name = "begin_end_cpu_log_test_marks";
    begin_cpu_log_test(name);
    let mut session = session_from_inline_asm(
        dir.path(),
        Mn1613SessionOptions {
            cpu_log_file: Some(log_file.clone()),
            ..Default::default()
        },
    )
    .expect("session");
    session.run_init().expect("run_init");
    end_cpu_log_test(name);
    let text = fs::read_to_string(&log_file).expect("read log");
    assert_eq!(text.lines().next(), Some(format!("{name} START").as_str()));
    assert!(text.contains(&format!("{name} END")));
}
