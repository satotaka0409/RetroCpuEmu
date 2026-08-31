//! MN1613 最小エミュ結合テスト（boot_monitor IHX → HALT + MEM_READ）。

use std::path::PathBuf;

use retrocpu_emu_rs::cpuboard::mn1613::cpu_core::ExecStatus;
use retrocpu_emu_rs::ioboard::{dma_load_intel_hex, mem_read, IoBoardSettings};
use retrocpu_emu_rs::{BoardLinkError, CpuBoardAgent, Mn1613CpuAgent};

/// リポジトリ内の boot_monitor.ihx を探す。
fn boot_ihx_path() -> PathBuf {
	let candidates = [
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/boot_monitor.ihx"),
		PathBuf::from(env!("CARGO_MANIFEST_DIR"))
			.join("../retrocpu_boot_monitor/build/hex/mn1613/mn1613_mon.ihx"),
	];
	for p in &candidates {
		if p.is_file() {
			return p.clone();
		}
	}
	panic!("boot_monitor.ihx not found; expected under assets/");
}

/// IHX を DMA し、リセット後にモニタが HALT するまで実行する。
fn boot_until_halt(agent: &mut Mn1613CpuAgent) -> ExecStatus {
	let path = boot_ihx_path();
	let text = std::fs::read_to_string(&path).expect("read ihx");
	dma_load_intel_hex(&text, |addr, data| {
		agent
			.dma_write_bytes(addr, data)
			.map_err(|_| retrocpu_emu_rs::ioboard::IntelHexError {
				message: "dma".into(),
			})
	})
	.expect("dma load");

	let settings = IoBoardSettings::default();
	agent.set_reset_vector(settings.reset_vector);
	agent
		.pulse_reset(Some(settings.reset_vector))
		.expect("reset");

	let st = agent.run_until_halt(5_000_000);
	assert!(
		matches!(st, ExecStatus::Halted),
		"expected Halted after boot, got {st:?} ic={:04X}",
		agent.core.get_state().ic
	);
	assert!(agent.is_halted());
	st
}

#[test]
fn boot_monitor_halts() {
	let mut agent = Mn1613CpuAgent::new();
	boot_until_halt(&mut agent);
}

#[test]
fn boot_monitor_mem_read_vector_table() {
	let mut agent = Mn1613CpuAgent::new();
	boot_until_halt(&mut agent);

	// g_reset_vector @ 0x0108: 少なくとも非零の STR/IC 語がある想定
	let bytes = mem_read(&mut agent, 0x0108 * 2, 8).expect("mem_read");
	assert_eq!(bytes.len(), 8);
	// ワード3 = 起動 IC（通常 g_main）。オール 0/FF でないこと
	let ic = ((bytes[6] as u16) << 8) | (bytes[7] as u16);
	assert_ne!(ic, 0);
	assert_ne!(ic, 0xffff);

	// 直接 RAM とも一致
	assert_eq!(agent.read_word(0x0108 + 3), ic);
}

#[test]
fn mem_write_then_read_roundtrip_after_boot() {
	let mut agent = Mn1613CpuAgent::new();
	boot_until_halt(&mut agent);

	let addr = 0x1800u32 * 2; // ユーザ領域
	agent.hshk_mem_write(addr, &[0x12, 0x34]).expect("write");
	let got = agent.hshk_mem_read(addr, 2).expect("read");
	assert_eq!(got, vec![0x12, 0x34]);
	assert_eq!(agent.read_word(0x1800), 0x1234);
}

#[test]
fn exec_from_halt_instruction_stays_halted() {
	let mut agent = Mn1613CpuAgent::new();
	boot_until_halt(&mut agent);

	// ユーザ領域に H (0x2000) を書き、82h で実行 → 即 HALT
	agent
		.hshk_mem_write(0x2000 * 2, &[0x20, 0x00])
		.expect("write H");
	agent.hshk_exec(0x2000 * 2).expect("exec");
	let st = agent.run_until_halt(1000);
	assert!(matches!(st, ExecStatus::Halted));
	let _ = BoardLinkError::Ng; // keep import used if optimized
}
