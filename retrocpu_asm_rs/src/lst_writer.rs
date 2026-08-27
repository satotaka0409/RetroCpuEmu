use std::collections::HashMap;

use crate::types::AssemblyResult;

pub fn write_lst(result: &AssemblyResult) -> String {
    let mut by_line: HashMap<usize, Vec<(u16, u16)>> = HashMap::new();
    for w in &result.words {
        by_line.entry(w.line_no).or_default().push((w.address, w.value));
    }

    let mut out = String::new();
    for s in &result.source_lines {
        if let Some(vs) = by_line.get(&s.line_no) {
            for (idx, (addr, val)) in vs.iter().enumerate() {
                if idx == 0 {
                    out.push_str(&format!("{:04X} {:04X}  {}\n", addr, val, s.text));
                } else {
                    out.push_str(&format!("{:04X} {:04X}\n", addr, val));
                }
            }
        } else {
            out.push_str(&format!("            {}\n", s.text));
        }
    }
    out
}