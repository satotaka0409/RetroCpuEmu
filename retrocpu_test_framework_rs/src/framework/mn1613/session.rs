//! MN1613 アセンブル成果物（HEX/CDB）実行セッション。
//!
//! 根拠: `retrocpu_test_framework_ts/src/mn1613/session.ts` / asm_test_framework.mdc

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use retrocpu_emu_rs::cpuboard::{
    Mn1613Core, Mn1613CpuRegister as CpuRegister,
    Mn1613CpuRegisterPatch as CpuRegisterPatch, Mn1613ExecStatus as ExecStatus,
    Mn1613IoCallbacks as IoCallbacks, Mn1613Ram, PHYS_MASK,
};
use retrocpu_emu_rs::ioboard::dma_load_intel_hex;

use crate::assemble_link::default_hex_cdb_paths;
use crate::cpu_log_mark::{clear_cpu_log_test_mark, set_active_cpu_log_marker};
use crate::error::FrameworkError;
use crate::handshake_mock::{
    with_framework_io_mock_defaults, CodeTestIoMock, IoBoardHandshakeMock, TestIoCallbacks,
};
use crate::json_value::CodeTestIoMockEntry;
use crate::types::{CdbCheckpointInfo, CdbSymbolInfo, CpuLogMode};

use super::cdb::{parse_cdb, require_symbol, CdbTable};
use super::cpu_log::CpuExecutionLog;
use super::m_sequence::create_m_sequence_memory;
use super::types::{
    CallMode, CallOptions, CallRegisters, CallResult, CallResultRegisters, Mn1613SessionOptions,
    RegisterExpect, StackWorkExpect,
};

const H_OPCODE: u16 = 0x2000;
const DEFAULT_STACK_INIT: u16 = 0xffff;
const DEFAULT_RETURN_STUB: u16 = 0x17fe;
const DEFAULT_MAX_CYCLES: u64 = 2_000_000;
const DEFAULT_MEMORY_BYTES: usize = 0x80_000;
const DEFAULT_INIT_LABEL: &str = "g_main";
const RESET_VECTOR_PORT: u16 = 0;
const MONITOR_ENTRY_WORD: u16 = 0x0108;

#[derive(Debug, Default)]
struct DefaultIo;

impl IoCallbacks for DefaultIo {
    fn io_read(&mut self, _port: u16) -> u16 {
        0xffff
    }
    fn io_write(&mut self, _port: u16, _val: u16) {}
}

fn u16(v: u32) -> u16 {
    (v & 0xffff) as u16
}

fn u18(v: u32) -> u32 {
    v & PHYS_MASK
}

fn hex4(v: u16) -> String {
    format!("{:04X}", v)
}

/// Intel HEX + CDB を載せて TS からサブルーチンを呼ぶセッション。
pub struct Mn1613AsmSession {
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
    pub init_label: Option<String>,
    pub stack_init: u16,
    pub return_stub_word_addr: u16,
    pub max_cycles: u64,
    pub memory_bytes: usize,
    pub memory_mseq_seed: u16,
    io_mock_entries: Option<Vec<CodeTestIoMockEntry>>,
    cdb: CdbTable,
    cdb_text: String,
    last_result: Option<CallResult>,
    last_pre_call_sp: u16,
    core: Mn1613Core,
    ram: Arc<Mutex<Mn1613Ram>>,
    attached_io_mock: Option<Arc<CodeTestIoMock>>,
    cpu_log: Option<Arc<CpuExecutionLog>>,
    cpu_log_path: Option<PathBuf>,
    cpu_log_mode: Option<CpuLogMode>,
}

impl Mn1613AsmSession {
    /// HEX/CDB パスとオプションからセッションを作る（`reload` は呼ばない）。
    pub fn new(
        hex_file: impl Into<PathBuf>,
        cdb_file: impl Into<PathBuf>,
        options: Mn1613SessionOptions,
    ) -> Result<Self, FrameworkError> {
        let hex_file = hex_file.into();
        let cdb_file = cdb_file.into();
        let cdb_text = fs::read_to_string(&cdb_file).map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to read CDB {}: {e}",
                cdb_file.display()
            ))
        })?;
        let cdb = parse_cdb(&cdb_text)?;
        let ram = Arc::new(Mutex::new(Mn1613Ram::new(false)));
        let mut session = Self {
            hex_file,
            cdb_file,
            init_label: options
                .init_label
                .unwrap_or_else(|| Some(DEFAULT_INIT_LABEL.to_string())),
            stack_init: options.stack_init.unwrap_or(DEFAULT_STACK_INIT),
            return_stub_word_addr: options.return_stub_word_addr.unwrap_or(DEFAULT_RETURN_STUB),
            max_cycles: options.max_cycles.unwrap_or(DEFAULT_MAX_CYCLES),
            memory_bytes: options.memory_bytes.unwrap_or(DEFAULT_MEMORY_BYTES),
            memory_mseq_seed: 0,
            io_mock_entries: options.io_mock.clone(),
            cdb,
            cdb_text,
            last_result: None,
            last_pre_call_sp: 0,
            core: Mn1613Core::new(),
            ram,
            attached_io_mock: None,
            cpu_log: None,
            cpu_log_path: options.cpu_log_file,
            cpu_log_mode: options.cpu_log_mode,
        };
        session.init_cpu_log()?;
        session.bind_cpu_log_hooks();
        Ok(session)
    }

    fn init_cpu_log(&mut self) -> Result<(), FrameworkError> {
        if let Some(ref log_path) = self.cpu_log_path {
            self.cpu_log = Some(CpuExecutionLog::new(
                log_path,
                &self.cdb_text,
                self.cpu_log_mode,
            )?);
        } else {
            self.cpu_log = None;
            clear_cpu_log_test_mark();
        }
        Ok(())
    }

    /// アタッチ中の ioMock。未設定なら None。
    pub fn io_mock(&self) -> Option<Arc<CodeTestIoMock>> {
        self.attached_io_mock.clone()
    }

    /// ioMock の handshake モック。無ければ None。
    pub fn handshake_mock(&self) -> Option<Arc<IoBoardHandshakeMock>> {
        self.attached_io_mock
            .as_ref()
            .and_then(|m| m.handshake.clone())
    }

    /// handshake モックが必須のテスト用。
    pub fn require_handshake_mock(&self) -> Result<Arc<IoBoardHandshakeMock>, FrameworkError> {
        self.handshake_mock().ok_or_else(|| {
            FrameworkError::invalid_argument(
                "ioMock handshake is not attached (set JsonTestSettings.ioMock)",
            )
        })
    }

    /// IO モックを外し、RD/WT を既定に戻す。
    pub fn detach_io_mock(&mut self) {
        self.attached_io_mock = None;
        self.core.set_io_callbacks(Box::new(DefaultIo));
    }

    fn apply_io_mock_on_init(&mut self) {
        self.apply_io_mock();
    }

    fn apply_io_mock(&mut self) {
        self.attached_io_mock = None;
        let entries = self.io_mock_entries.clone().unwrap_or_default();
        if entries.is_empty() {
            let io = TestIoCallbacks::empty();
            io.port_state()
                .lock()
                .expect("ports lock")
                .reads
                .entry(RESET_VECTOR_PORT)
                .or_insert(MONITOR_ENTRY_WORD);
            self.core.set_io_callbacks(Box::new(io));
            return;
        }
        let attached = CodeTestIoMock::new(&with_framework_io_mock_defaults(entries))
            .expect("ioMock entries validated at attach");
        let io = attached.build_io_callbacks();
        io.port_state()
            .lock()
            .expect("ports lock")
            .reads
            .entry(RESET_VECTOR_PORT)
            .or_insert(MONITOR_ENTRY_WORD);
        self.attached_io_mock = Some(attached);
        self.core.set_io_callbacks(Box::new(io));
    }

    /// HEX を再ロードし CPU を reset する。
    pub fn reload(&mut self) -> Result<(), FrameworkError> {
        self.bind_cpu_log_hooks();
        let filled = create_m_sequence_memory(self.memory_bytes, None)?;
        self.memory_mseq_seed = filled.seed;
        {
            let mut ram = self.ram.lock().expect("ram lock");
            *ram = Mn1613Ram::new(false);
            for (i, chunk) in filled.buffer.chunks(2).enumerate() {
                if chunk.len() == 2 {
                    let w = u16::from_be_bytes([chunk[0], chunk[1]]);
                    ram.write_phys(i as u32, w);
                }
            }
        }
        let hex_text = fs::read_to_string(&self.hex_file).map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to read HEX {}: {e}",
                self.hex_file.display()
            ))
        })?;
        {
            let mut ram = self.ram.lock().expect("ram lock");
            dma_load_intel_hex(&hex_text, |addr, data| {
                ram.dma_write_bytes(addr, data);
                Ok(())
            })
            .map_err(|e| FrameworkError::invalid_argument(format!("Intel HEX load failed: {e}")))?;
        }
        self.apply_io_mock();
        self.core.reset(&self.ram.lock().expect("ram lock"));
        self.write_return_stub();
        self.last_result = None;
        self.last_pre_call_sp = 0;
        if let Some(log) = &self.cpu_log {
            log.reset_hits();
            log.begin_run("reload", "");
        }
        Ok(())
    }

    fn write_return_stub(&mut self) {
        self.write_word(self.return_stub_word_addr, H_OPCODE);
    }

    /// `initLabel` を HALT まで実行する。
    pub fn run_init(&mut self) -> Result<(), FrameworkError> {
        self.bind_cpu_log_hooks();
        let Some(label) = self.init_label.clone() else {
            return Ok(());
        };
        let entry = self.word_addr(&label)?;
        if let Some(log) = &self.cpu_log {
            log.begin_run("runInit", &label);
        }
        let status = self.run_until_halt(entry)?;
        let st = self.core.get_state();
        if status != ExecStatus::Halted {
            return Err(FrameworkError::invalid_argument(format!(
                "runInit({label}): expected halted, status={status:?} IC=0x{}",
                hex4(st.ic)
            )));
        }
        Ok(())
    }

    /// 指定ワードアドレスから HALT まで実行する（TS `run()` 相当）。
    pub fn run(&mut self, entry: u16) -> Result<ExecStatus, FrameworkError> {
        self.bind_cpu_log_hooks();
        self.core.set_state(&CpuRegisterPatch {
            ic: Some(entry),
            ..Default::default()
        });
        self.core.set_exec_status(ExecStatus::Running);
        if let Some(log) = &self.cpu_log {
            log.begin_run("run", &format!("0x{}", hex4(entry)));
        }
        self.run_until_halt(entry)
    }

    /// 現在の CPU レジスタ（TS `getState()` 相当）。
    pub fn cpu_state(&self) -> CpuRegister {
        self.core.get_state()
    }

    /// CPU レジスタを部分更新する（TS `setState()` 相当）。
    pub fn set_cpu_state(&mut self, patch: &CpuRegisterPatch) {
        self.core.set_state(patch);
    }

    /// 割り込み要求（level 0–2）。`int_cause` は IO:0021 へ載せる値（省略可）。
    pub fn trigger_interrupt(&mut self, level: u8, int_cause: Option<u8>) {
        if let Some(cause) = int_cause {
            if let Some(mock) = &self.attached_io_mock {
                if let Some(hs) = &mock.handshake {
                    hs.set_int_cause(cause);
                }
            }
        }
        self.core.trigger_interrupt(level);
    }

    fn run_until_halt(&mut self, entry: u16) -> Result<ExecStatus, FrameworkError> {
        let mut ic = entry;
        let mut remaining = self.max_cycles as usize;
        while remaining > 0 {
            let batch = remaining.min(4096);
            let st = match self
                .core
                .run_slice(&mut self.ram.lock().expect("ram lock"), Some(ic), batch)
            {
                Ok(st) => st,
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("max cycles reached") {
                        remaining = remaining.saturating_sub(batch);
                        ic = self.core.get_state().ic;
                        continue;
                    }
                    return Err(FrameworkError::invalid_argument(format!("run: {e}")));
                }
            };
            remaining = remaining.saturating_sub(batch);
            if matches!(
                st,
                ExecStatus::Halted | ExecStatus::Break | ExecStatus::Step
            ) {
                return Ok(st);
            }
            ic = self.core.get_state().ic;
        }
        Err(FrameworkError::invalid_argument("max cycles exceeded"))
    }

    /// CDB グローバルのワードアドレス。
    pub fn word_addr(&self, name: &str) -> Result<u16, FrameworkError> {
        Ok(u16(require_symbol(&self.cdb, name)?.word_addr))
    }

    pub fn get_symbol(&self, name: &str) -> Result<CdbSymbolInfo, FrameworkError> {
        let s = require_symbol(&self.cdb, name)?;
        Ok(CdbSymbolInfo {
            name: s.name.clone(),
            byte_addr: s.byte_addr,
            word_addr: s.word_addr,
        })
    }

    pub fn get_checkpoints(&self) -> &[CdbCheckpointInfo] {
        &self.cdb.checkpoints
    }

    pub fn write_word(&mut self, word_addr: u16, value: u16) {
        self.ram
            .lock()
            .expect("ram lock")
            .write_phys(u18(word_addr as u32), value);
    }

    pub fn write_word_phys(&mut self, word_addr: u32, value: u16) {
        self.ram
            .lock()
            .expect("ram lock")
            .write_phys(u18(word_addr), value);
    }

    pub fn read_word(&self, word_addr: u16) -> u16 {
        self.ram
            .lock()
            .expect("ram lock")
            .read_phys(u18(word_addr as u32))
    }

    pub fn read_word_phys(&self, word_addr: u32) -> u16 {
        self.ram.lock().expect("ram lock").read_phys(u18(word_addr))
    }

    pub fn write_label_words(&mut self, name: &str, words: &[u16]) -> Result<(), FrameworkError> {
        let base = self.word_addr(name)?;
        for (i, w) in words.iter().enumerate() {
            self.write_word(base.wrapping_add(i as u16), *w);
        }
        Ok(())
    }

    /// サブルーチンを呼び、戻りスタブの H で止まるまで実行する。
    pub fn call(
        &mut self,
        label: &str,
        options: CallOptions,
    ) -> Result<CallResult, FrameworkError> {
        self.bind_cpu_log_hooks();
        if options.reset_cpu {
            self.core.reset(&self.ram.lock().expect("ram lock"));
            self.write_return_stub();
        }

        let entry = self.word_addr(label)?;
        if let Some(log) = &self.cpu_log {
            log.begin_run("call", label);
        }
        apply_call_registers(&mut self.core, options.registers.as_ref());

        let mut sp = options
            .registers
            .as_ref()
            .and_then(|r| r.sp)
            .unwrap_or(self.stack_init);
        if let Some(stack) = &options.stack {
            for &word in stack {
                self.write_word(sp, word);
                sp = u16(sp as u32 - 1);
            }
        }
        self.write_word(sp, self.return_stub_word_addr);
        sp = u16(sp as u32 - 1);
        if matches!(options.call_mode, Some(CallMode::Balr)) {
            let csbr = self.core.get_state().csbr as u16;
            self.write_word(sp, csbr & 0xf);
            sp = u16(sp as u32 - 1);
        }
        self.core.set_state(&CpuRegisterPatch {
            sp: Some(sp),
            ..Default::default()
        });

        let pre_call_sp = self.core.get_state().sp;
        self.last_pre_call_sp = pre_call_sp;
        let status = self.run_until_halt(entry)?;
        let reg = self.core.get_state();
        if status != ExecStatus::Halted {
            return Err(FrameworkError::invalid_argument(format!(
                "call({label}): expected halted at stub, status={status:?} IC=0x{}",
                hex4(reg.ic)
            )));
        }
        let ic = reg.ic;
        let stub = self.return_stub_word_addr;
        if ic != stub && ic != stub.wrapping_add(1) {
            return Err(FrameworkError::invalid_argument(format!(
                "call({label}): did not return to stub (IC=0x{}, stub=0x{})",
                hex4(ic),
                hex4(stub)
            )));
        }

        let result = CallResult {
            registers: CallResultRegisters {
                r: reg.r,
                sp: reg.sp,
                str_reg: reg.str,
                ic: reg.ic,
                csbr: reg.csbr as u16,
                ssbr: reg.ssbr as u16,
                iisr: reg.iisr,
            },
            pre_call_sp,
            entry_word_addr: entry,
        };
        self.last_result = Some(result.clone());
        Ok(result)
    }

    pub fn expect_registers(
        &self,
        expected: &RegisterExpect,
        actual: Option<&CallResultRegisters>,
    ) -> Result<(), FrameworkError> {
        if let Some(reg) = actual {
            return check_all_regs(reg, expected);
        }
        if let Some(last) = &self.last_result {
            return check_all_regs(&last.registers, expected);
        }
        let s = self.core.get_state();
        let reg = CallResultRegisters {
            r: s.r,
            sp: s.sp,
            str_reg: s.str,
            ic: s.ic,
            csbr: s.csbr as u16,
            ssbr: s.ssbr as u16,
            iisr: s.iisr,
        };
        check_all_regs(&reg, expected)
    }

    pub fn expect_memory_words(
        &self,
        word_addr: u16,
        expected: &[u16],
    ) -> Result<(), FrameworkError> {
        let actual: Vec<u16> = expected
            .iter()
            .enumerate()
            .map(|(i, _)| self.read_word(word_addr.wrapping_add(i as u16)))
            .collect();
        assert_words(&format!("mem@0x{}", hex4(word_addr)), &actual, expected)
    }

    pub fn expect_memory_words_phys(
        &self,
        word_addr: u32,
        expected: &[u16],
    ) -> Result<(), FrameworkError> {
        let actual: Vec<u16> = expected
            .iter()
            .enumerate()
            .map(|(i, _)| self.read_word_phys((word_addr + i as u32) & PHYS_MASK))
            .collect();
        assert_words(
            &format!("mem@0x{:05X}", word_addr & PHYS_MASK),
            &actual,
            expected,
        )
    }

    pub fn expect_label_words(&self, name: &str, expected: &[u16]) -> Result<(), FrameworkError> {
        self.expect_memory_words(self.word_addr(name)?, expected)
    }

    pub fn expect_stack_work(&self, spec: &StackWorkExpect) -> Result<(), FrameworkError> {
        let base = self.last_pre_call_sp.max(
            self.last_result
                .as_ref()
                .map(|r| r.pre_call_sp)
                .unwrap_or(0),
        );
        if base == 0 {
            return Err(FrameworkError::invalid_argument(
                "expectStackWork: no preCallSp (call first)",
            ));
        }
        let start = u16((base as i32 + spec.offset) as u32);
        let actual: Vec<u16> = spec
            .words
            .iter()
            .enumerate()
            .map(|(i, _)| self.read_word(start.wrapping_add(i as u16)))
            .collect();
        assert_words(
            &format!("stack@preCallSp+{}", spec.offset),
            &actual,
            &spec.words,
        )
    }

    pub fn set_cpu_log_mode(&mut self, mode: Option<CpuLogMode>) {
        self.cpu_log_mode = mode;
        if let Some(log) = &self.cpu_log {
            log.set_mode(mode);
        }
    }

    fn bind_cpu_log_hooks(&mut self) {
        if let Some(log) = &self.cpu_log {
            let log_before = Arc::clone(log);
            let log_after = Arc::clone(log);
            self.core
                .set_on_before_execute(Some(Box::new(move |st, ram| {
                    log_before.on_before_execute(st, |a| ram.read_phys(u18(a as u32)));
                })));
            self.core
                .set_on_after_execute(Some(Box::new(move |st, ram| {
                    log_after.on_after_execute(st, |a| ram.read_phys(u18(a as u32)));
                })));
            set_active_cpu_log_marker(Some(log.clone()));
        } else {
            clear_cpu_log_test_mark();
            self.core.set_on_before_execute(None);
            self.core.set_on_after_execute(None);
        }
    }
}

fn apply_call_registers(core: &mut Mn1613Core, regs: Option<&CallRegisters>) {
    let Some(regs) = regs else {
        return;
    };
    let mut patch = CpuRegisterPatch::default();
    let mut r = [None; 5];
    if let Some(v) = regs.r0 {
        r[0] = Some(v);
    }
    if let Some(v) = regs.r1 {
        r[1] = Some(v);
    }
    if let Some(v) = regs.r2 {
        r[2] = Some(v);
    }
    if let Some(v) = regs.r3 {
        r[3] = Some(v);
    }
    if let Some(v) = regs.r4 {
        r[4] = Some(v);
    }
    if r.iter().any(|x| x.is_some()) {
        patch.r = Some(r);
    }
    patch.sp = regs.sp;
    patch.str = regs.str_reg;
    patch.ic = regs.ic;
    patch.iisr = regs.iisr;
    patch.npp = regs.npp;
    patch.csbr = regs.csbr.map(|v| v as u8);
    patch.ssbr = regs.ssbr.map(|v| v as u8);
    patch.tsr0 = regs.tsr0.map(|v| v as u8);
    patch.tsr1 = regs.tsr1.map(|v| v as u8);
    if let Some(osr) = regs.osr {
        patch.osr = Some([
            Some(osr[0]),
            Some(osr[1]),
            Some(osr[2]),
            Some(osr[3]),
        ]);
    }
    core.set_state(&patch);
}

fn check_all_regs(
    reg: &CallResultRegisters,
    expected: &RegisterExpect,
) -> Result<(), FrameworkError> {
    check_reg("R0", reg.r[0], expected.r0)?;
    check_reg("R1", reg.r[1], expected.r1)?;
    check_reg("R2", reg.r[2], expected.r2)?;
    check_reg("R3", reg.r[3], expected.r3)?;
    check_reg("R4", reg.r[4], expected.r4)?;
    check_reg("SP", reg.sp, expected.sp)?;
    check_reg("STR", reg.str_reg, expected.str_reg)?;
    check_reg("CSBR", reg.csbr, expected.csbr)?;
    check_reg("SSBR", reg.ssbr, expected.ssbr)?;
    check_reg("IC", reg.ic, expected.ic)?;
    check_reg("IISR", reg.iisr, expected.iisr)?;
    Ok(())
}

fn check_reg(name: &str, got: u16, exp: Option<u16>) -> Result<(), FrameworkError> {
    if let Some(exp) = exp {
        if (got & 0xffff) != (exp & 0xffff) {
            return Err(FrameworkError::invalid_argument(format!(
                "register {name}: expected 0x{}, got 0x{}",
                hex4(exp),
                hex4(got)
            )));
        }
    }
    Ok(())
}

fn assert_words(label: &str, actual: &[u16], expected: &[u16]) -> Result<(), FrameworkError> {
    if actual.len() != expected.len() {
        return Err(FrameworkError::invalid_argument(format!(
            "{label}: length {} !== {}",
            actual.len(),
            expected.len()
        )));
    }
    for (i, (&a, &e)) in actual.iter().zip(expected.iter()).enumerate() {
        if (a & 0xffff) != (e & 0xffff) {
            return Err(FrameworkError::invalid_argument(format!(
                "{label}[{i}]: expected 0x{}, got 0x{}",
                hex4(e),
                hex4(a)
            )));
        }
    }
    Ok(())
}

/// HEX/CDB をロードしたセッションを作る（`reload` 済み）。
pub fn create_mn1613_asm_session(
    options: Mn1613SessionOptions,
) -> Result<Mn1613AsmSession, FrameworkError> {
    let defaults = default_hex_cdb_paths();
    let hex_file = options.hex_file.clone().unwrap_or(defaults.hex_file);
    let cdb_file = options.cdb_file.clone().unwrap_or(defaults.cdb_file);
    if !hex_file.is_file() {
        return Err(FrameworkError::invalid_argument(format!(
            "Intel HEX がありません: {}\nMakefile 等で .ihx / .cdb をビルドしてからテストしてください",
            hex_file.display()
        )));
    }
    if !cdb_file.is_file() {
        return Err(FrameworkError::invalid_argument(format!(
            "CDB がありません: {}\nMakefile 等で .ihx / .cdb をビルドしてからテストしてください",
            cdb_file.display()
        )));
    }
    let mut session = Mn1613AsmSession::new(hex_file, cdb_file, options)?;
    session.apply_io_mock_on_init();
    session.reload()?;
    Ok(session)
}
