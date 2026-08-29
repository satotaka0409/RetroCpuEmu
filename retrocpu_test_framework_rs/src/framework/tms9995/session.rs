use std::fs;
use std::path::PathBuf;

use crate::error::FrameworkError;

use super::calling_convention::{
    plan_tms9995_call, TMS9995_DEFAULT_ARG_REGISTERS, TMS9995_DEFAULT_STACK_INIT,
    TMS9995_DEFAULT_WORKSPACE,
};
use super::cdb::{parse_tms9995_cdb, require_tms9995_symbol};
use super::intel_hex::load_intel_hex;
use super::types::{CdbSymbol, CdbTable, Tms9995CallPlan, Tms9995CallPlanOptions};

const DEFAULT_MEMORY_BYTES: usize = 0x10000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995SessionOptions {
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
    pub memory_bytes: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Tms9995ArtifactSession {
    memory: Vec<u8>,
    cdb: CdbTable,
    hex_file: PathBuf,
    cdb_file: PathBuf,
    memory_bytes: usize,
}

impl Tms9995ArtifactSession {
    pub fn new(options: Tms9995SessionOptions) -> Result<Self, FrameworkError> {
        let memory_bytes = options.memory_bytes.unwrap_or(DEFAULT_MEMORY_BYTES);
        let mut out = Self {
            memory: vec![0; memory_bytes],
            cdb: CdbTable::default(),
            hex_file: options.hex_file,
            cdb_file: options.cdb_file,
            memory_bytes,
        };
        out.reload()?;
        Ok(out)
    }

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

        self.memory.fill(0);
        load_intel_hex(&hex_text, &mut self.memory)?;
        self.cdb = parse_tms9995_cdb(&cdb_text)?;
        Ok(())
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

    pub fn read_byte(&self, byte_addr: u32) -> Result<u8, FrameworkError> {
        let a = byte_addr as usize;
        if a >= self.memory_bytes {
            return Err(FrameworkError::invalid_argument(format!(
                "read_byte out of range: 0x{byte_addr:x}"
            )));
        }
        Ok(self.memory[a])
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
        Ok(((self.memory[a] as u16) << 8) | (self.memory[a + 1] as u16))
    }

    pub fn read_words_be(&self, byte_addr: u32, count: usize) -> Result<Vec<u16>, FrameworkError> {
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            out.push(self.read_word_be(byte_addr + (i as u32) * 2)?);
        }
        Ok(out)
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
            opts.stack_init = Some(TMS9995_DEFAULT_STACK_INIT);
        }
        plan_tms9995_call(&opts)
    }

    pub fn default_workspace(&self) -> u16 {
        TMS9995_DEFAULT_WORKSPACE
    }

    pub fn default_stack_init(&self) -> u16 {
        TMS9995_DEFAULT_STACK_INIT
    }

    pub fn run_init(&self) -> Result<(), FrameworkError> {
        Err(FrameworkError::not_implemented(
            "Tms9995ArtifactSession.run_init (TMS9995 CPU emu)",
        ))
    }

    pub fn call(&self, _label: &str) -> Result<(), FrameworkError> {
        Err(FrameworkError::not_implemented(
            "Tms9995ArtifactSession.call (TMS9995 CPU emu)",
        ))
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

    #[test]
    fn artifact_session_loads_hex_cdb_and_reads_memory() {
        let dir = unique_temp_dir();
        let hex_file = dir.join("t.ihx");
        let cdb_file = dir.join("t.cdb");
        fs::write(&hex_file, ":0401000002011122C5\n:00000001FF\n").expect("hex write");
        fs::write(&cdb_file, "L:G$g_foo$0$0:0100\n").expect("cdb write");

        let session = create_tms9995_artifact_session(Tms9995SessionOptions {
            hex_file: hex_file.clone(),
            cdb_file: cdb_file.clone(),
            memory_bytes: None,
        })
        .expect("session creation should work");

        let addr = session
            .require_byte_addr("g_foo")
            .expect("symbol should exist");
        assert_eq!(addr % 2, 0);
        let w0 = session.read_word_be(addr).expect("word read should work");
        assert_ne!(w0, 0);

        let mut plan_opts = Tms9995CallPlanOptions::default();
        plan_opts.args = vec![0x11, 0x22];
        let plan = session.plan_call(&plan_opts).expect("plan should work");
        assert_eq!(plan.registers[2], 0x11);
        assert_eq!(plan.registers[3], 0x22);
        assert_eq!(plan.sp_after_push, session.default_stack_init());

        assert!(session.call("g_foo").is_err());

        let _ = fs::remove_file(hex_file);
        let _ = fs::remove_file(cdb_file);
        let _ = fs::remove_dir_all(dir);
    }
}
