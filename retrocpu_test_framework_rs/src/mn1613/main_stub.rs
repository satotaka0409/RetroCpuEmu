use crate::types::AsmCpuType;

pub fn mn1613_default_code_org_word(cpu: AsmCpuType, has_main: bool) -> u16 {
    if has_main {
        return 0;
    }
    match cpu {
        AsmCpuType::Mn1613 => 0x0200,
        AsmCpuType::Tms9995 => 0,
    }
}

pub fn mn1613_main_stub(org_word: u16, cpu: AsmCpuType) -> String {
    let cpu_name = match cpu {
        AsmCpuType::Mn1613 => "mn1613",
        AsmCpuType::Tms9995 => "tms9995",
    };

    format!(
        "\t.cpu\t{cpu_name}\n\t.area\t_CODE\t\t(REL,CON)\n\t.org\t0x{org_word:04X}\n\t.global\t__TEST_FRAME_MAIN\n__TEST_FRAME_MAIN:\n\th\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_org_depends_on_main_and_cpu() {
        assert_eq!(
            mn1613_default_code_org_word(AsmCpuType::Mn1613, false),
            0x0200
        );
        assert_eq!(mn1613_default_code_org_word(AsmCpuType::Mn1613, true), 0);
        assert_eq!(mn1613_default_code_org_word(AsmCpuType::Tms9995, false), 0);
    }

    #[test]
    fn stub_contains_directives() {
        let s = mn1613_main_stub(0x0200, AsmCpuType::Mn1613);
        assert!(s.contains("\t.cpu\tmn1613"));
        assert!(s.contains("\t.org\t0x0200"));
        assert!(s.contains("__TEST_FRAME_MAIN:"));
    }
}
