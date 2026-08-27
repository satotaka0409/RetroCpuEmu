use crate::types::AssemblyResult;

pub fn write_rel(result: &AssemblyResult, module_name: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "; retrocpu_asm_rs REL (baseline) module={}\n",
        module_name
    ));
    out.push_str("; symbols\n");

    let mut keys: Vec<&String> = result.symbols.keys().collect();
    keys.sort();
    for k in keys {
        let v = result.symbols.get(k).copied().unwrap_or(0);
        out.push_str(&format!("S {} {:04X}\n", k, v));
    }

    out.push_str("; words\n");
    for w in &result.words {
        out.push_str(&format!("W {:04X} {:04X}\n", w.address, w.value));
    }

    out
}
