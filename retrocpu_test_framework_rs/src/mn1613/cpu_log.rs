//! テスト専用 CPU 実行ログ。
//!
//! 根拠: `asm_test_framework.mdc` §テスト専用 CPU ログ出力 /
//! `retrocpu_test_framework_ts/src/mn1613/cpu_log.ts`

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

use retrocpu_emu_rs::cpuboard::cpu_core::mn1613::CpuRegister;

use crate::cdb::parse_cdb;
use crate::cpu_log_mark::{
    set_active_cpu_log_marker, take_pending_cpu_log_test_name, CpuLogMarker, CpuLogTestPhase,
};
use crate::error::FrameworkError;
use crate::mn1613::disasm::Mn1613Disassembler;
use crate::types::CpuLogMode;

const STACK_WORDS: usize = 16;

fn hex4(n: u16) -> String {
    format!("{:04X}", n & 0xffff)
}

/// CDB のチェックポイントからワードアドレス → ログ用名を作る。
pub fn checkpoints_by_word_addr(cdb_text: &str) -> Result<std::collections::HashMap<u16, String>, FrameworkError> {
    let cdb = parse_cdb(cdb_text)?;
    let mut map = std::collections::HashMap::new();
    for cp in &cdb.checkpoints {
        let label = format!("{}${}", cp.name, cp.serial);
        let addr = (cp.word_addr & 0xffff) as u16;
        map.entry(addr)
            .and_modify(|prev: &mut String| {
                prev.push(',');
                prev.push_str(&label);
            })
            .or_insert(label);
    }
    Ok(map)
}

/// レジスタをログ用 1 フィールドにする。
pub fn format_cpu_log_regs(st: &CpuRegister) -> String {
    [
        format!("R0={}", hex4(st.r[0])),
        format!("R1={}", hex4(st.r[1])),
        format!("R2={}", hex4(st.r[2])),
        format!("R3={}", hex4(st.r[3])),
        format!("R4={}", hex4(st.r[4])),
        format!("SP={}", hex4(st.sp)),
        format!("STR={}", hex4(st.str)),
        format!("IC={}", hex4(st.ic)),
        format!("CSBR={:X}", st.csbr & 0xf),
        format!("SSBR={:X}", st.ssbr & 0xf),
        format!("TSR0={:X}", st.tsr0 & 0xf),
        format!("TSR1={:X}", st.tsr1 & 0xf),
        format!("OSR0={}", hex4(u16::from(st.osr[0]))),
        format!("OSR1={}", hex4(u16::from(st.osr[1]))),
        format!("OSR2={}", hex4(u16::from(st.osr[2]))),
        format!("OSR3={}", hex4(u16::from(st.osr[3]))),
        format!("NPP={:02X}", st.npp),
        format!("IISR={}", hex4(st.iisr)),
        format!("SBRB={}", hex4(st.sbrb)),
    ]
    .join(" ")
}

/// SP+1 から 16 ワードを読む。
pub fn format_cpu_log_stack(sp: u16, read_word: impl Fn(u16) -> u16) -> String {
    let mut words = Vec::with_capacity(STACK_WORDS);
    for i in 1..=STACK_WORDS {
        words.push(hex4(read_word(sp.wrapping_add(i as u16))));
    }
    words.join(" ")
}

#[derive(Debug, Clone)]
struct PendingInstruction {
    ic: u16,
    name: String,
    hit: u32,
    data: String,
    disasm: String,
}

/// テスト専用 CPU ログ。
pub struct CpuExecutionLog {
    file_path: PathBuf,
    mode: Mutex<Option<CpuLogMode>>,
    checkpoints: std::collections::HashMap<u16, String>,
    disasm: Mn1613Disassembler,
    hits: Mutex<std::collections::HashMap<u16, u32>>,
    pending: Mutex<Option<PendingInstruction>>,
    write_lock: Mutex<()>,
    log_clock: AtomicU64,
}

impl CpuExecutionLog {
    /// 出力ファイルを作る（既存なら切り詰める）。
    pub fn new(
        file_path: impl AsRef<Path>,
        cdb_text: &str,
        mode: Option<CpuLogMode>,
    ) -> Result<Arc<Self>, FrameworkError> {
        let file_path = file_path.as_ref().to_path_buf();
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                FrameworkError::invalid_argument(format!(
                    "failed to create cpu log dir {}: {e}",
                    parent.display()
                ))
            })?;
        }
        fs::write(&file_path, "").map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to truncate cpu log {}: {e}",
                file_path.display()
            ))
        })?;

        let log = Arc::new(Self {
            file_path,
            mode: Mutex::new(mode),
            checkpoints: checkpoints_by_word_addr(cdb_text)?,
            disasm: Mn1613Disassembler::new(),
            hits: Mutex::new(std::collections::HashMap::new()),
            pending: Mutex::new(None),
            write_lock: Mutex::new(()),
            log_clock: AtomicU64::new(0),
        });

        set_active_cpu_log_marker(Some(log.clone()));
        if let Some(name) = take_pending_cpu_log_test_name() {
            log.append_test_mark(&name, CpuLogTestPhase::Start);
        }
        Ok(log)
    }

    /// 現在の本文モード。`None` は START/END のみ。
    pub fn log_mode(&self) -> Option<CpuLogMode> {
        *self.mode.lock().expect("mode lock")
    }

    /// 出力モードを切り替える。
    pub fn set_mode(&self, mode: Option<CpuLogMode>) {
        *self.mode.lock().expect("mode lock") = mode;
        if let Ok(mut pending) = self.pending.lock() {
            *pending = None;
        }
    }

    /// このテスト開始時点からの通過回数を捨てる（reload 時）。
    pub fn reset_hits(&self) {
        if let Ok(mut hits) = self.hits.lock() {
            hits.clear();
        }
        if let Ok(mut pending) = self.pending.lock() {
            *pending = None;
        }
    }

    /// セクション見出しを書く（本文モード無しでは書かない）。
    pub fn begin_run(&self, kind: &str, label: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = None;
        }
        if self.log_mode().is_none() {
            return;
        }
        let extra = if label.is_empty() {
            String::new()
        } else {
            format!(" {label}")
        };
        let _ = self.append_line(&format!("# {kind}{extra}"));
    }

    /// フェッチ直前。
    pub fn on_before_execute(
        &self,
        state: &CpuRegister,
        read_word: impl Fn(u16) -> u16,
    ) {
        let Some(mode) = self.log_mode() else {
            if let Ok(mut pending) = self.pending.lock() {
                *pending = None;
            }
            return;
        };

        let ic = state.ic & 0xffff;
        let cp_name = self.checkpoints.get(&ic).cloned();

        match mode {
            CpuLogMode::Checkpoint => {
                let Some(name) = cp_name else {
                    if let Ok(mut pending) = self.pending.lock() {
                        *pending = None;
                    }
                    return;
                };
                let pending = self.capture_pending(ic, &name, &read_word);
                if let Ok(mut slot) = self.pending.lock() {
                    *slot = Some(pending.clone());
                }
                self.write_record("before", &pending, state, &read_word);
            }
            CpuLogMode::Instruction => {
                let pending = self.capture_pending(ic, cp_name.as_deref().unwrap_or("-"), &read_word);
                if let Ok(mut slot) = self.pending.lock() {
                    *slot = Some(pending);
                }
            }
        }
    }

    /// 命令実行直後。
    pub fn on_after_execute(
        &self,
        state: &CpuRegister,
        read_word: impl Fn(u16) -> u16,
    ) {
        if self.log_mode().is_none() {
            if let Ok(mut pending) = self.pending.lock() {
                *pending = None;
            }
            return;
        }
        let pending = self.pending.lock().ok().and_then(|mut g| g.take());
        let Some(pending) = pending else {
            return;
        };
        self.write_record("after", &pending, state, &read_word);
    }

    fn capture_pending(&self, ic: u16, name: &str, read_word: &dyn Fn(u16) -> u16) -> PendingInstruction {
        let hit = {
            let mut hits = self.hits.lock().expect("hits lock");
            let next = hits.get(&ic).copied().unwrap_or(0) + 1;
            hits.insert(ic, next);
            next
        };
        let dis = self.disasm.disassemble(ic, read_word);
        let mut data_words = Vec::new();
        for i in 0..dis.word_count {
            data_words.push(hex4(read_word(ic.wrapping_add(i as u16))));
        }
        PendingInstruction {
            ic,
            name: name.to_string(),
            hit,
            data: data_words.join(" "),
            disasm: dis.text,
        }
    }

    fn write_record(
        &self,
        phase: &str,
        pending: &PendingInstruction,
        state: &CpuRegister,
        read_word: &dyn Fn(u16) -> u16,
    ) {
        self.log_clock.fetch_add(4, Ordering::Relaxed);
        let line = [
            self.log_clock.load(Ordering::Relaxed).to_string(),
            hex4(pending.ic),
            pending.data.clone(),
            pending.name.clone(),
            phase.to_string(),
            pending.hit.to_string(),
            pending.disasm.clone(),
            format_cpu_log_regs(state),
            format_cpu_log_stack(state.sp, read_word),
        ]
        .join("\t");
        let _ = self.append_line(&line);
    }

    fn append_line(&self, line: &str) -> Result<(), FrameworkError> {
        let _guard = self.write_lock.lock().expect("write lock");
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)
            .map_err(|e| {
                FrameworkError::invalid_argument(format!(
                    "failed to open cpu log {}: {e}",
                    self.file_path.display()
                ))
            })?;
        writeln!(file, "{line}").map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to write cpu log {}: {e}",
                self.file_path.display()
            ))
        })
    }
}

impl CpuLogMarker for CpuExecutionLog {
    fn append_test_mark(&self, name: &str, phase: CpuLogTestPhase) {
        let p = match phase {
            CpuLogTestPhase::Start => "START",
            CpuLogTestPhase::End => "END",
        };
        let _ = self.append_line(&format!("{name} {p}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::CpuLogMode;

    #[test]
    fn format_regs_and_stack() {
        let st = CpuRegister {
            r: [3, 4, 0, 0, 0],
            sp: 0xfffe,
            ..Default::default()
        };
        assert!(format_cpu_log_regs(&st).contains("R0=0003"));
        let stack = format_cpu_log_stack(0xfffe, |a| a);
        assert_eq!(stack.split(' ').count(), 16);
    }

    #[test]
    fn checkpoint_mode_writes_before_after() -> Result<(), FrameworkError> {
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("cpu.log");
        let cdb = "L:__CP$add_enter$0001:0404\n";
        let log = CpuExecutionLog::new(
            &log_path,
            cdb,
            Some(CpuLogMode::Checkpoint),
        )?;
        log.begin_run("call", "gl_add");
        let read = |a: u16| if a == 0x0202 { 0x5809 } else { 0 };
        let before = CpuRegister {
            ic: 0x0202,
            r: [3, 4, 0, 0, 0],
            sp: 0xfffe,
            ..Default::default()
        };
        log.on_before_execute(&before, read);
        let after = CpuRegister {
            ic: 0x0203,
            r: [7, 4, 0, 0, 0],
            sp: 0xfffe,
            ..Default::default()
        };
        log.on_after_execute(&after, read);
        let text = fs::read_to_string(&log_path).expect("read log");
        assert!(text.contains("add_enter$0001\tbefore\t1\tA R0, R1"));
        assert!(text.contains("add_enter$0001\tafter\t1"));
        Ok(())
    }
}
