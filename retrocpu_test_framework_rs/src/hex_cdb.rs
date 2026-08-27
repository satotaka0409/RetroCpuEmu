use std::collections::HashMap;

fn checksum(bytes: &[u8]) -> u8 {
    let sum = bytes.iter().fold(0_u16, |acc, &b| (acc + b as u16) & 0xff);
    (!sum as u8).wrapping_add(1)
}

pub fn image_to_intel_hex(image: &[u8]) -> String {
    let mut lines: Vec<String> = Vec::new();

    let mut addr: usize = 0;
    while addr < image.len() {
        let end = (addr + 16).min(image.len());
        let chunk = &image[addr..end];

        if chunk.iter().all(|&b| b == 0) {
            addr += 16;
            continue;
        }

        let mut rec: Vec<u8> = Vec::with_capacity(5 + chunk.len());
        rec.push(chunk.len() as u8);
        rec.push(((addr >> 8) & 0xff) as u8);
        rec.push((addr & 0xff) as u8);
        rec.push(0);
        rec.extend_from_slice(chunk);
        rec.push(checksum(&rec));

        let line = format!(
            ":{}",
            rec.iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join("")
        );
        lines.push(line);

        addr += 16;
    }

    lines.push(":00000001FF".to_string());
    format!("{}\n", lines.join("\n"))
}

pub fn defs_to_cdb(defs: &HashMap<String, u32>) -> String {
    let mut names: Vec<&String> = defs
        .keys()
        .filter(|n| {
            let up = n.to_ascii_uppercase();
            !(up.starts_with("__CP$")
                || (up.len() == 8
                    && up.starts_with("__CP")
                    && up[4..].chars().all(|c| c.is_ascii_digit())))
        })
        .collect();
    names.sort();

    let mut lines = Vec::with_capacity(names.len());
    for name in names {
        let byte_addr = defs.get(name).copied().unwrap_or(0);
        lines.push(format!("L:G${}$0$0:{:X}", name, byte_addr));
    }

    format!("{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intel_hex_skips_zero_chunks_and_has_eof() {
        let mut image = vec![0_u8; 64];
        image[0x10] = 0x12;
        image[0x11] = 0x34;
        let hex = image_to_intel_hex(&image);
        assert!(hex.contains(":100010001234"));
        assert!(hex.ends_with(":00000001FF\n"));
    }

    #[test]
    fn cdb_filters_checkpoint_symbols() {
        let mut defs = HashMap::new();
        defs.insert("gl_main".to_string(), 0x200);
        defs.insert("__CP0001".to_string(), 0x1234);
        defs.insert("__CP$foo$0001".to_string(), 0x1234);
        let cdb = defs_to_cdb(&defs);
        assert!(cdb.contains("L:G$gl_main$0$0:200"));
        assert!(!cdb.contains("__CP0001"));
        assert!(!cdb.contains("__CP$foo$0001"));
    }
}
