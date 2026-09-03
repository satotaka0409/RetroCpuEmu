//! TMS9995 アセンブル成果物（HEX/CDB）実行セッション。
//!
//! 根拠: `retrocpu_test_framework_ts/src/tms9995/session.ts` / asm_test_framework.mdc

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use retrocpu_emu_rs::cpuboard::{
    Tms9995Bus, Tms9995Core, Tms9995Ram, Tms9995State, Tms9995StepResult,
};

use crate::error::FrameworkError;

use super::calling_convention::{
    plan_tms9995_call, TMS9995_DEFAULT_ARG_REGISTERS, TMS9995_DEFAULT_STACK_INIT,
    TMS9995_DEFAULT_WORKSPACE,
};
use super::cdb::{parse_tms9995_cdb, require_tms9995_symbol};
use super::cru_adapter::{Tms9995CruHandshakeAdapter, Tms9995EmptyCruAdapter};
use super::cru_handshake::{Tms9995CruHandshakeMock, Tms9995CruHandshakeOptions};
use super::intel_hex::load_intel_hex_overlay;
use super::types::{
    CdbSymbol, CdbTable,     Tms9995CallOptions, Tms9995CallPlan, Tms9995CallPlanOptions, Tms9995CallResult,
};

const DEFAULT_MEMORY_BYTES: usize = 0x10000;
const DEFAULT_MAX_CYCLES: u64 = 2_000_000;
const DEFAULT_INIT_LABEL: &str = "g_main";
const DEFAULT_RETURN_STUB: u16 = 0x1ffe;
const IDLE_OPCODE: u16 = 0x0340;

fn hex4(v: u16) -> String {
    format!("{v:04X}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995SessionOptions {
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
    pub memory_bytes: Option<usize>,
    pub init_label: Option<String>,
    pub max_cycles: Option<u64>,
    pub stack_init: Option<u16>,
    pub workspace: Option<u16>,
    pub return_stub: Option<u16>,
    /// true なら CRU ハンドシェイクモックを attach する。
    pub cru_handshake: bool,
}

impl Default for Tms9995SessionOptions {
    fn default() -> Self {
        Self {
            hex_file: PathBuf::new(),
            cdb_file: PathBuf::new(),
            memory_bytes: None,
            init_label: None,
            max_cycles: None,
            stack_init: None,
            workspace: None,
            return_stub: None,
            cru_handshake: true,
        }
    }
}

/// TMS9995 HEX/CDB 実行セッション（旧成果物名を API 互換のため維持）。
pub struct Tms9995ArtifactSession {
    core: Tms9995Core,
    ram: Tms9995Ram,
    cru_empty: Tms9995EmptyCruAdapter,
    cru_handshake: Option<Arc<Mutex<Tms9995CruHandshakeMock>>>,
    cdb: CdbTable,
    hex_file: PathBuf,
    cdb_file: PathBuf,
    init_label: Option<String>,
    max_cycles: u64,
    memory_bytes: usize,
    stack_init: u16,
    workspace: u16,
    return_stub: u16,
    last_result: Option<Tms9995CallResult>,
    pre_call_sp: u16,
}

/// `Tms9995ArtifactSession` の別名（実行セッション意味）。
pub type Tms9995AsmSession = Tms9995ArtifactSession;

impl Tms9995ArtifactSession {
    /// HEX/CDB パスとオプションからセッションを作る（`reload` 済み）。
    pub fn new(options: Tms9995SessionOptions) -> Result<Self, FrameworkError> {
        let memory_bytes = options.memory_bytes.unwrap_or(DEFAULT_MEMORY_BYTES);
        let mut out = Self {
            core: Tms9995Core::new(),
            ram: Tms9995Ram::new(memory_bytes, false),
            cru_empty: Tms9995EmptyCruAdapter::new(),
            cru_handshake: if options.cru_handshake {
                Some(Arc::new(Mutex::new(Tms9995CruHandshakeMock::new(
                    Tms9995CruHandshakeOptions::default(),
                ))))
            } else {
                None
            },
            cdb: CdbTable::default(),
            hex_file: options.hex_file,
            cdb_file: options.cdb_file,
            init_label: options
                .init_label
                .or_else(|| Some(DEFAULT_INIT_LABEL.to_string())),
            max_cycles: options.max_cycles.unwrap_or(DEFAULT_MAX_CYCLES),
            memory_bytes,
            stack_init: options.stack_init.unwrap_or(TMS9995_DEFAULT_STACK_INIT),
            workspace: options.workspace.unwrap_or(TMS9995_DEFAULT_WORKSPACE),
            return_stub: options.return_stub.unwrap_or(DEFAULT_RETURN_STUB),
            last_result: None,
            pre_call_sp: 0,
        };
        out.reload()?;
        Ok(out)
    }

    /// CPU をリセットベクタから再初期化する（RAM は維持）。
    pub fn reset_cpu(&mut self) {
        self.core.reset_from_vector(&self.ram);
        self.write_return_stub();
    }

    /// HEX を再ロードし CPU を reset する。
    pub fn reload(&mut self) -> Result<(), FrameworkError> {
        let hex_text = fs::read_to_string(&self.hex_file).map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to read HEX {}: {e}",
                self.hex_file.display()
            ))
        })?;
        let cdb_text = fs::read_to_string(&self.cdb_file).map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to read CDB {}: {e}",
                self.cdb_file.display()
            ))
        })?;

        self.ram = Tms9995Ram::new(self.memory_bytes, true);
        load_intel_hex_overlay(&hex_text, &mut self.ram)?;
        self.cdb = parse_tms9995_cdb(&cdb_text)?;
        self.core.reset_from_vector(&self.ram);
        self.write_return_stub();
        if let Some(mock) = &self.cru_handshake {
            mock.lock().expect("cru mock lock").reset();
        }
        self.cru_empty = Tms9995EmptyCruAdapter::new();
        self.last_result = None;
        self.pre_call_sp = 0;
        Ok(())
    }

    fn write_return_stub(&mut self) {
        self.ram.write_word(self.return_stub, IDLE_OPCODE);
    }

    fn run_until_idle(&mut self, entry_pc: u16) -> Result<(), FrameworkError> {
        self.core.set_state(Tms9995State {
            pc: entry_pc & 0xfffe,
            wp: self.core.state().wp,
            st: self.core.state().st,
            idle: false,
        });

        let max = self.max_cycles as usize;
        if let Some(mock) = &self.cru_handshake {
            let mut adapter = Tms9995CruHandshakeAdapter::new(mock.clone());
            for _ in 0..max {
                match self.core.step(&mut self.ram, &mut adapter) {
                    Ok(Tms9995StepResult::Idle) => return Ok(()),
                    Ok(Tms9995StepResult::Running) => {
                        std::thread::yield_now();
                    }
                    Err(e) => {
                        return Err(FrameworkError::invalid_argument(format!("run: {e}")));
                    }
                }
            }
            return Err(FrameworkError::invalid_argument(format!(
                "run: max cycles reached ({max})"
            )));
        }
        self.core
            .run(&mut self.ram, &mut self.cru_empty, max)
            .map_err(|e| FrameworkError::invalid_argument(format!("run: {e}")))?;
        Ok(())
    }

    fn snapshot_registers(&self, wp: u16) -> [u16; 16] {
        let mut out = [0_u16; 16];
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = self.ram.read_word(wp.wrapping_add((i as u16) * 2));
        }
        out
    }

    fn reg_byte_addr(wp: u16, reg: usize) -> u16 {
        wp.wrapping_add((reg as u16) * 2)
    }

    fn write_register_bank(&mut self, wp: u16, registers: &[u16; 16]) {
        for (i, &value) in registers.iter().enumerate() {
            self.ram
                .write_word(Self::reg_byte_addr(wp, i), value);
        }
    }

    /// `initLabel` を IDLE まで実行する。
    pub fn run_init(&mut self) -> Result<(), FrameworkError> {
        let Some(label) = self.init_label.clone() else {
            return Ok(());
        };
        let entry = self.require_byte_addr(&label)?;
        self.run_until_idle(entry as u16)?;
        let st = self.core.state();
        if !st.idle {
            return Err(FrameworkError::invalid_argument(format!(
                "runInit({label}): expected idle, pc=0x{} idle={}",
                hex4(st.pc),
                st.idle
            )));
        }
        Ok(())
    }

    /// サブルーチンを呼び、戻りスタブの IDLE で止まるまで実行する。
    pub fn call(
        &mut self,
        label: &str,
        options: Tms9995CallOptions,
    ) -> Result<Tms9995CallResult, FrameworkError> {
        if options.reset_cpu {
            self.core.reset_from_vector(&self.ram);
            self.write_return_stub();
        }

        let entry = self.require_byte_addr(label)? as u16;
        let wp = options.workspace.unwrap_or(self.workspace);
        if (wp & 1) != 0 {
            return Err(FrameworkError::invalid_argument(format!(
                "workspace must be even byte address (got 0x{wp:04x})"
            )));
        }

        let plan_opts = Tms9995CallPlanOptions {
            args: options.args.clone(),
            stack_init: options.stack_init.or(Some(self.stack_init)),
            return_addr: Some(self.return_stub),
            arg_registers: Some(TMS9995_DEFAULT_ARG_REGISTERS.to_vec()),
            allow_special_purpose_registers: false,
        };
        let plan = plan_tms9995_call(&plan_opts)?;

        let mut registers = plan.registers;
        if let Some(explicit) = &options.registers {
            for (i, value) in explicit.r.iter().enumerate() {
                if let Some(v) = value {
                    registers[i] = *v;
                }
            }
        }

        self.write_register_bank(wp, &registers);
        for sw in &plan.stack_words {
            self.ram.write_word(sw.byte_addr, sw.value);
        }
        self.write_return_stub();

        self.pre_call_sp = plan.sp_after_push;
        self.core.set_state(Tms9995State {
            pc: entry,
            wp,
            st: 0,
            idle: false,
        });

        self.run_until_idle(entry)?;

        let st = self.core.state();
        if !st.idle {
            return Err(FrameworkError::invalid_argument(format!(
                "call({label}): expected idle at stub, pc=0x{} idle={}",
                hex4(st.pc),
                st.idle
            )));
        }
        let stub = self.return_stub;
        if st.pc != stub && st.pc != stub.wrapping_add(2) {
            return Err(FrameworkError::invalid_argument(format!(
                "call({label}): did not return to stub (PC=0x{}, stub=0x{})",
                hex4(st.pc),
                hex4(stub)
            )));
        }

        let result = Tms9995CallResult {
            registers: self.snapshot_registers(wp),
            wp,
            pc: st.pc,
            st: st.st,
            pre_call_sp: self.pre_call_sp,
        };
        self.last_result = Some(result.clone());
        Ok(result)
    }

    pub fn require_byte_addr(&self, name: &str) -> Result<u32, FrameworkError> {
        Ok(require_tms9995_symbol(&self.cdb, name)?.byte_addr)
    }

    pub fn require_symbol(&self, name: &str) -> Result<CdbSymbol, FrameworkError> {
        require_tms9995_symbol(&self.cdb, name)
    }

    pub fn cdb(&self) -> &CdbTable {
        &self.cdb
    }

    pub fn last_call_result(&self) -> Option<&Tms9995CallResult> {
        self.last_result.as_ref()
    }

    pub fn core_state(&self) -> Tms9995State {
        self.core.state()
    }

    pub fn read_byte(&self, byte_addr: u32) -> Result<u8, FrameworkError> {
        let a = byte_addr as usize;
        if a >= self.memory_bytes {
            return Err(FrameworkError::invalid_argument(format!(
                "read_byte out of range: 0x{byte_addr:x}"
            )));
        }
        Ok(self.ram.read_byte(byte_addr as u16))
    }

    pub fn write_byte(&mut self, byte_addr: u32, value: u8) -> Result<(), FrameworkError> {
        let a = byte_addr as usize;
        if a >= self.memory_bytes {
            return Err(FrameworkError::invalid_argument(format!(
                "write_byte out of range: 0x{byte_addr:x}"
            )));
        }
        self.ram.write_byte(byte_addr as u16, value);
        Ok(())
    }

    pub fn read_word_be(&self, byte_addr: u32) -> Result<u16, FrameworkError> {
        if (byte_addr & 1) != 0 {
            return Err(FrameworkError::invalid_argument(format!(
                "read_word_be requires even address (got 0x{byte_addr:x})"
            )));
        }
        let a = byte_addr as usize;
        if a + 1 >= self.memory_bytes {
            return Err(FrameworkError::invalid_argument(format!(
                "read_word_be out of range: 0x{byte_addr:x}"
            )));
        }
        Ok(self.ram.read_word(byte_addr as u16))
    }

    pub fn write_word_be(&mut self, byte_addr: u32, value: u16) -> Result<(), FrameworkError> {
        if (byte_addr & 1) != 0 {
            return Err(FrameworkError::invalid_argument(format!(
                "write_word_be requires even address (got 0x{byte_addr:x})"
            )));
        }
        let a = byte_addr as usize;
        if a + 1 >= self.memory_bytes {
            return Err(FrameworkError::invalid_argument(format!(
                "write_word_be out of range: 0x{byte_addr:x}"
            )));
        }
        self.ram.write_word(byte_addr as u16, value);
        Ok(())
    }

    pub fn read_words_be(&self, byte_addr: u32, count: usize) -> Result<Vec<u16>, FrameworkError> {
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            out.push(self.read_word_be(byte_addr + (i as u32) * 2)?);
        }
        Ok(out)
    }

    pub fn read_reg(&self, wp: u16, reg: u8) -> Result<u16, FrameworkError> {
        if reg > 15 {
            return Err(FrameworkError::invalid_argument(format!(
                "register out of range: {reg}"
            )));
        }
        Ok(self.ram.read_word(Self::reg_byte_addr(wp, reg as usize)))
    }

    pub fn write_reg(&mut self, wp: u16, reg: u8, value: u16) -> Result<(), FrameworkError> {
        if reg > 15 {
            return Err(FrameworkError::invalid_argument(format!(
                "register out of range: {reg}"
            )));
        }
        self.ram
            .write_word(Self::reg_byte_addr(wp, reg as usize), value);
        Ok(())
    }

    pub fn read_bios_jump_target(&self, table_byte_addr: u32) -> Result<u16, FrameworkError> {
        self.read_word_be(table_byte_addr + 2)
    }

    pub fn plan_call(
        &self,
        options: &Tms9995CallPlanOptions,
    ) -> Result<Tms9995CallPlan, FrameworkError> {
        let mut opts = options.clone();
        if opts.arg_registers.is_none() {
            opts.arg_registers = Some(TMS9995_DEFAULT_ARG_REGISTERS.to_vec());
        }
        if opts.stack_init.is_none() {
            opts.stack_init = Some(self.stack_init);
        }
        if opts.return_addr.is_none() {
            opts.return_addr = Some(self.return_stub);
        }
        plan_tms9995_call(&opts)
    }

    pub fn default_workspace(&self) -> u16 {
        self.workspace
    }

    pub fn default_stack_init(&self) -> u16 {
        self.stack_init
    }

    pub fn return_stub_addr(&self) -> u16 {
        self.return_stub
    }

    /// CRU ハンドシェイクモックを attach する。
    pub fn attach_cru_handshake(&mut self) {
        if self.cru_handshake.is_none() {
            self.cru_handshake = Some(Arc::new(Mutex::new(Tms9995CruHandshakeMock::new(
                Tms9995CruHandshakeOptions::default(),
            ))));
        }
    }

    /// handshake モックが必須のテスト用。
    pub fn require_cru_handshake_mock(
        &self,
    ) -> Result<Arc<Mutex<Tms9995CruHandshakeMock>>, FrameworkError> {
        self.cru_handshake.clone().ok_or_else(|| {
            FrameworkError::invalid_argument(
                "CRU handshake mock is not attached (set Tms9995SessionOptions.cru_handshake)",
            )
        })
    }

    pub fn cru_handshake_mock(&self) -> Option<Arc<Mutex<Tms9995CruHandshakeMock>>> {
        self.cru_handshake.clone()
    }

    pub fn expect_registers(&self, expected: &[Option<u16>; 16]) -> Result<(), FrameworkError> {
        let actual = if let Some(last) = &self.last_result {
            last.registers
        } else {
            let wp = self.core.state().wp;
            self.snapshot_registers(wp)
        };
        for (i, exp) in expected.iter().enumerate() {
            if let Some(want) = exp {
                if actual[i] != *want {
                    return Err(FrameworkError::invalid_argument(format!(
                        "R{i} expected 0x{} got 0x{}",
                        hex4(*want),
                        hex4(actual[i])
                    )));
                }
            }
        }
        Ok(())
    }

    pub fn expect_memory_words(
        &self,
        byte_addr: u32,
        expected: &[u16],
    ) -> Result<(), FrameworkError> {
        let actual = self.read_words_be(byte_addr, expected.len())?;
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            if a != e {
                return Err(FrameworkError::invalid_argument(format!(
                    "mem@0x{}+{} expected 0x{} got 0x{}",
                    hex4(byte_addr as u16),
                    i * 2,
                    hex4(*e),
                    hex4(*a)
                )));
            }
        }
        Ok(())
    }
}

pub fn create_tms9995_artifact_session(
    options: Tms9995SessionOptions,
) -> Result<Tms9995ArtifactSession, FrameworkError> {
    Tms9995ArtifactSession::new(options)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::framework::tms9995::Tms9995CallRegisters;

    fn unique_temp_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        p.push(format!("tf-rs-tms9995-{nanos}"));
        fs::create_dir_all(&p).expect("temp dir should be created");
        p
    }

    fn write_smoke_files(dir: &PathBuf) -> (PathBuf, PathBuf) {
        let hex_file = dir.join("t.ihx");
        let cdb_file = dir.join("t.cdb");
        fs::write(&hex_file, ":00000001FF\n").expect("hex write");
        fs::write(
            &cdb_file,
            "L:G$g_main$0$0:0200\nL:G$g_foo$0$0:0300\n",
        )
        .expect("cdb write");
        (hex_file, cdb_file)
    }

    fn setup_smoke_memory(session: &mut Tms9995ArtifactSession) {
        session
            .write_word_be(0x0000, TMS9995_DEFAULT_WORKSPACE)
            .expect("write wp vector");
        session
            .write_word_be(0x0002, 0x0200)
            .expect("write pc vector");
        session
            .write_word_be(0x0200, IDLE_OPCODE)
            .expect("write idle main");
        session.reset_cpu();
    }

    #[test]
    fn artifact_session_loads_hex_cdb_and_reads_memory() {
        let dir = unique_temp_dir();
        let (hex_file, cdb_file) = write_smoke_files(&dir);

        let mut session = create_tms9995_artifact_session(Tms9995SessionOptions {
            hex_file: hex_file.clone(),
            cdb_file: cdb_file.clone(),
            memory_bytes: None,
            init_label: None,
            max_cycles: None,
            stack_init: None,
            workspace: None,
            return_stub: None,
            cru_handshake: false,
        })
        .expect("session creation should work");
        setup_smoke_memory(&mut session);

        let addr = session
            .require_byte_addr("g_main")
            .expect("symbol should exist");
        assert_eq!(addr, 0x0200);
        assert_eq!(
            session.read_word_be(addr).expect("word read"),
            IDLE_OPCODE
        );

        let mut plan_opts = Tms9995CallPlanOptions::default();
        plan_opts.args = vec![0x11, 0x22];
        let plan = session.plan_call(&plan_opts).expect("plan should work");
        assert_eq!(plan.registers[2], 0x11);
        assert_eq!(plan.registers[3], 0x22);
        assert_eq!(plan.sp_after_push, session.default_stack_init());

        let _ = fs::remove_file(hex_file);
        let _ = fs::remove_file(cdb_file);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn run_init_reaches_idle_on_idle_main() {
        let dir = unique_temp_dir();
        let (hex_file, cdb_file) = write_smoke_files(&dir);

        let mut session = create_tms9995_artifact_session(Tms9995SessionOptions {
            hex_file,
            cdb_file,
            memory_bytes: None,
            init_label: Some("g_main".to_string()),
            max_cycles: Some(10_000),
            stack_init: None,
            workspace: None,
            return_stub: None,
            cru_handshake: false,
        })
        .expect("session");
        setup_smoke_memory(&mut session);

        session.run_init().expect("run_init should idle");
        assert!(session.core_state().idle);
        let pc = session.core_state().pc;
        assert!(pc == 0x0200 || pc == 0x0202, "pc=0x{pc:04X}");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn call_subroutine_returns_to_idle_stub() {
        let dir = unique_temp_dir();
        let (hex_file, cdb_file) = write_smoke_files(&dir);

        let mut session = create_tms9995_artifact_session(Tms9995SessionOptions {
            hex_file,
            cdb_file,
            memory_bytes: None,
            init_label: None,
            max_cycles: Some(10_000),
            stack_init: None,
            workspace: None,
            return_stub: None,
            cru_handshake: false,
        })
        .expect("session");
        setup_smoke_memory(&mut session);

        // CLR R1 ; B *R11
        session
            .write_word_be(0x0300, 0x04c1)
            .expect("write clr");
        session
            .write_word_be(0x0302, 0x044b)
            .expect("write branch");

        let result = session
            .call(
                "g_foo",
                Tms9995CallOptions {
                    registers: Some(Tms9995CallRegisters {
                        r: {
                            let mut r = [None; 16];
                            r[1] = Some(0xabcd);
                            r
                        },
                    }),
                    ..Tms9995CallOptions::default()
                },
            )
            .expect("call should return");

        assert_eq!(result.registers[1], 0);
        let stub = session.return_stub_addr();
        assert!(
            result.pc == stub || result.pc == stub.wrapping_add(2),
            "pc=0x{:04X} stub=0x{stub:04X}",
            result.pc
        );
        assert!(session.core_state().idle);

        let _ = fs::remove_dir_all(dir);
    }
}
