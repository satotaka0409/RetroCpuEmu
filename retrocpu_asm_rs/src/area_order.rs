//! リンク時の `.area` 順序と asxxxx フラグ（TS `areaOrder.ts` 相当）。

/// リンク時 CON 領域の優先順。
pub const AREA_LINK_ORDER: &[&str] = &[
	"_VECTOR",
	"_SYS_PAGE0",
	"_USR_PAGE0",
	"_BIOS",
	"_CODE",
	"_DATA",
	"_WORK",
];

const A3_OVR: u16 = 0x04;

/// 無名領域は `_CODE`。
pub fn canonical_area_name(name: &str) -> String {
	let u = name.trim().to_ascii_uppercase();
	if u.is_empty() {
		"_CODE".to_string()
	} else {
		u
	}
}

/// リンク／REL 出力用に領域名を並べる。
pub fn order_link_area_names(names: impl IntoIterator<Item = impl AsRef<str>>) -> Vec<String> {
	let mut set: std::collections::BTreeSet<String> = names
		.into_iter()
		.map(|n| canonical_area_name(n.as_ref()))
		.filter(|n| !n.is_empty())
		.collect();
	let mut out = Vec::new();
	for n in AREA_LINK_ORDER {
		if set.remove(*n) {
			out.push((*n).to_string());
		}
	}
	out.extend(set.into_iter());
	out
}

/// asxxxx A レコード flags。
pub fn asxxxx_area_flags(name: &str, _noload: bool) -> u16 {
	let n = canonical_area_name(name);
	if n == "_VECTOR" {
		A3_OVR
	} else {
		0
	}
}
