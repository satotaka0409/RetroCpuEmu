//! `sample/` 配下の網羅用ソースがエラーなくアセンブルできることを検証する。

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::assemble;
    use crate::types::AddressUnit;

    /// `sample/` 内の相対パスから絶対パスを組み立てる。
    fn sample_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sample")
            .join(name)
    }

    /// サンプルソースを読み込む。
    fn read_sample(name: &str) -> String {
        let path = sample_path(name);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
    }

    #[test]
    fn mn1613_all_instructions_assembles() {
        let src = read_sample("mn1613_all_instructions.asm");
        let r = assemble(&src, None).unwrap_or_else(|e| {
            panic!("assemble mn1613_all_instructions.asm: {e}")
        });
        assert_eq!(r.address_unit, AddressUnit::Word);
        assert!(r.words.len() > 100, "expected substantial MN1613 output");
    }

    #[test]
    fn tms9995_all_instructions_assembles() {
        let src = read_sample("tms9995_all_instructions.asm");
        let r = assemble(&src, None).unwrap_or_else(|e| {
            panic!("assemble tms9995_all_instructions.asm: {e}")
        });
        assert_eq!(r.address_unit, AddressUnit::Byte);
        assert!(r.words.len() > 50, "expected substantial TMS9995 output");
        assert_eq!(r.symbols.get("START"), Some(&0x1000));
    }

    #[test]
    fn all_sample_asm_files_assemble_without_error() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample");
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "asm"))
            .collect();
        paths.sort();

        assert!(!paths.is_empty(), "no .asm files under sample/");

        for path in paths {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string());
            let src = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {name}: {e}"));
            assemble(&src, None).unwrap_or_else(|e| panic!("assemble {name}: {e}"));
        }
    }
}
