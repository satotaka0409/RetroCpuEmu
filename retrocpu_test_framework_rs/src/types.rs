use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsmCpuType {
    Mn1613,
    Tms9995,
}

impl AsmCpuType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mn1613 => "mn1613",
            Self::Tms9995 => "tms9995",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpuLogMode {
    Checkpoint,
    Instruction,
}

/// 1 モジュール分の入力（ファイルまたはインライン）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsmSource {
    File {
        file: PathBuf,
        module: Option<String>,
    },
    Text {
        text: String,
        module: String,
        from_dir: Option<PathBuf>,
    },
}

/// アセンブル＋リンクの入力。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembleLinkOptions {
    pub sources: Vec<AsmSource>,
    pub cpu: AsmCpuType,
    /// `_CODE` 原点（ワード）。省略時は MAIN 有無で決定。
    pub code_org_word: Option<u16>,
}

/// HEX / CDB ファイルへ書き出すときの追加指定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembleToFilesOptions {
    pub link: AssembleLinkOptions,
    pub hex_file: PathBuf,
    pub cdb_file: PathBuf,
}

/// 1 モジュールのアセンブル結果（リンク前）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledModule {
    pub module: String,
    pub source_path: String,
    pub symbols: HashMap<String, u16>,
}

/// リンク済みチェックポイント。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedCheckpoint {
    pub name: String,
    pub serial: String,
    pub id: String,
    pub byte_addr: u32,
    pub word_addr: u32,
}

/// リンク済みイメージとシンボル。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedImage {
    pub cpu: AsmCpuType,
    pub image: Vec<u8>,
    pub globals: HashMap<String, u32>,
    pub global_bytes: HashMap<String, u32>,
    pub hex_text: String,
    pub cdb_text: String,
    pub modules: Vec<AssembledModule>,
    pub checkpoints: Vec<LinkedCheckpoint>,
}

/// CDB シンボル（テストから参照）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdbSymbolInfo {
    pub name: String,
    pub byte_addr: u32,
    pub word_addr: u32,
}

/// CDB チェックポイント（`; @cp`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdbCheckpointInfo {
    pub id: String,
    pub name: String,
    pub serial: String,
    pub byte_addr: u32,
    pub word_addr: u32,
}
