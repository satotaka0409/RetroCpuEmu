//! TMS9995 handshake 実行回帰テスト共通ヘルパー。

use std::sync::Arc;

use retrocpu_test_framework_rs::framework::tms9995::{
    create_tms9995_session_from_settings, Tms9995AsmSession, Tms9995CallOptions,
    Tms9995CallRegisters, Tms9995CruIoBoardMock,
};
use retrocpu_test_framework_rs::FrameworkError;

pub const HSHK_OK: u16 = 0x00;
pub const HSHK_NG: u16 = 0x01;

pub fn expect_ok_r2() -> [Option<u16>; 16] {
    let mut r = [None; 16];
    r[2] = Some(HSHK_OK);
    r
}

pub fn expect_ng_r2() -> [Option<u16>; 16] {
    let mut r = [None; 16];
    r[2] = Some(HSHK_NG);
    r
}

pub fn monitor_artifact_exists(settings: &retrocpu_test_framework_rs::JsonTestSettings) -> bool {
    let hex = std::path::PathBuf::from(&settings.hex_file);
    let cdb = std::path::PathBuf::from(&settings.cdb_file);
    if !hex.is_file() || !cdb.is_file() {
        eprintln!(
            "skip: missing tms9995 monitor artifact: {} / {}",
            hex.display(),
            cdb.display()
        );
        return false;
    }
    true
}

/// callee-saved R6/R7/R9 を埋めた既定レジスタ（R8=return stub）。
pub fn base_regs(session: &Tms9995AsmSession) -> Tms9995CallRegisters {
    let mut r = [None; 16];
    r[6] = Some(0x6666);
    r[7] = Some(0x7777);
    r[8] = Some(session.return_stub_addr());
    r[9] = Some(0x9999);
    Tms9995CallRegisters { r }
}

pub fn call_opts(session: &Tms9995AsmSession, args: &[u16]) -> Tms9995CallOptions {
    Tms9995CallOptions {
        args: args.to_vec(),
        registers: Some(base_regs(session)),
        ..Default::default()
    }
}

pub fn call_regs(session: &Tms9995AsmSession, overlay: &[Option<u16>; 16]) -> Tms9995CallOptions {
    let mut merged = base_regs(session);
    for (i, v) in overlay.iter().enumerate() {
        if v.is_some() {
            merged.r[i] = *v;
        }
    }
    Tms9995CallOptions {
        registers: Some(merged),
        ..Default::default()
    }
}

pub struct HandshakeCase {
    pub session: Tms9995AsmSession,
    pub io: Arc<Tms9995CruIoBoardMock>,
}

pub fn with_handshake_case<F>(
    settings: &retrocpu_test_framework_rs::JsonTestSettings,
    f: F,
) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut HandshakeCase) -> Result<(), FrameworkError>,
{
    with_handshake_case_ext(settings, f)
}

pub fn with_handshake_case_ext<F>(
    settings: &retrocpu_test_framework_rs::JsonTestSettings,
    f: F,
) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut HandshakeCase) -> Result<(), FrameworkError>,
{
    if !monitor_artifact_exists(settings) {
        return Ok(());
    }
    let mut session = create_tms9995_session_from_settings(settings, None)?;
    session.run_init()?;
    if session.require_byte_addr("g_hshk_addr_break_init").is_ok() {
        let _ = session.call("g_hshk_addr_break_init", call_regs(&session, &[None; 16]))?;
    }
    let cru = session.require_cru_handshake_mock()?;
    let io = Arc::new(Tms9995CruIoBoardMock::new(Arc::clone(&cru)));
    let mut case = HandshakeCase { session, io };
    f(&mut case)
}

pub fn call_handler(
    case: &mut HandshakeCase,
    to_cpu: &[u8],
    from_cpu_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let opts = call_regs(&case.session, &[None; 16]);
    let session = &mut case.session;
    case.io.run_io_handler_exchange(to_cpu, from_cpu_len, || {
        let _ = session.call("g_handshake_interrupt_handler", opts)?;
        Ok(())
    })
}

pub fn call_cpu_to_io(
    case: &mut HandshakeCase,
    label: &str,
    opts: Tms9995CallOptions,
) -> Result<Vec<u8>, FrameworkError> {
    let session = &mut case.session;
    case.io.run_with_cpu_to_io_request(|| {
        let _ = session.call(label, opts)?;
        Ok(())
    })
}

pub fn write_byte_buf(session: &mut Tms9995AsmSession, byte_addr: u16, bytes: &[u8]) {
    for (i, b) in bytes.iter().enumerate() {
        session
            .write_byte(u32::from(byte_addr.wrapping_add(i as u16)), *b)
            .expect("write byte");
    }
}

pub fn read_slot_words(session: &Tms9995AsmSession, slot: u8) -> Result<[u16; 6], FrameworkError> {
    let base = session.require_byte_addr("GL_HSHK_ADDR_BREAK")? as u16;
    let off = (slot as u16) * 12;
    let mut out = [0_u16; 6];
    for (i, w) in out.iter_mut().enumerate() {
        *w = session.read_word_be((base + off + (i as u16 * 2)) as u32)?;
    }
    Ok(out)
}

pub fn write_slot_words(
    session: &mut Tms9995AsmSession,
    slot: u8,
    words: [u16; 6],
) -> Result<(), FrameworkError> {
    let base = session.require_byte_addr("GL_HSHK_ADDR_BREAK")? as u16;
    let off = (slot as u16) * 12;
    for (i, w) in words.iter().enumerate() {
        session.write_word_be((base + off + (i as u16 * 2)) as u32, *w)?;
    }
    Ok(())
}

pub fn break_set_frame(slot: u8, flags: u8, count: u8, addr: u32, data: u16) -> Vec<u8> {
    vec![
        0x10,
        slot,
        flags,
        count,
        ((addr >> 24) & 0xff) as u8,
        ((addr >> 16) & 0xff) as u8,
        ((addr >> 8) & 0xff) as u8,
        (addr & 0xff) as u8,
        ((data >> 8) & 0xff) as u8,
        (data & 0xff) as u8,
    ]
}

const BH_ENTRY_BYTES: u32 = 78;
const BH_SLOT_BYTES: u32 = 312;

pub fn plant_hist_entry(session: &mut Tms9995AsmSession, slot: u8, index: u8, mark: u16) {
    let base = 0xE000u32 + (slot as u32) * BH_SLOT_BYTES + (index as u32) * BH_ENTRY_BYTES;
    session.write_word_be(base, mark).expect("write hist mark");
    session.write_word_be(base + 8, 0xa5a5).expect("write data");
    for i in 10..39u32 {
        session
            .write_word_be(base + i * 2, 0x1000 + i as u16)
            .expect("write hist fill");
    }
}

pub fn write_hist_meta(
    session: &mut Tms9995AsmSession,
    slot: u8,
    count: u16,
    next: u16,
    ovf: u16,
) -> Result<(), FrameworkError> {
    let meta_base = session.require_byte_addr("GL_BP_HIST_META")?;
    let off = meta_base + u32::from(slot) * 6;
    session.write_word_be(off, count)?;
    session.write_word_be(off + 2, next)?;
    session.write_word_be(off + 4, ovf)?;
    Ok(())
}

pub fn mem_read_header(byte_addr: u32, byte_count: u32) -> Vec<u8> {
    vec![
        0x13,
        ((byte_addr >> 24) & 0xff) as u8,
        ((byte_addr >> 16) & 0xff) as u8,
        ((byte_addr >> 8) & 0xff) as u8,
        (byte_addr & 0xff) as u8,
        ((byte_count >> 24) & 0xff) as u8,
        ((byte_count >> 16) & 0xff) as u8,
        ((byte_count >> 8) & 0xff) as u8,
        (byte_count & 0xff) as u8,
        0,
    ]
}

pub fn mem_write_header(byte_addr: u32, byte_count: u32) -> Vec<u8> {
    let mut h = mem_read_header(byte_addr, byte_count);
    h[0] = 0x14;
    h
}

const CPU_OUT_HSHK_OUT_DENA: u16 = 0x0021;
const CPU_IN_HSHK_IN_REQ: u16 = 0x0024;

pub fn cpu_to_io_bytes(case: &mut HandshakeCase, bytes: &[u8]) -> Result<Vec<u8>, FrameworkError> {
    let session = &mut case.session;
    let opts = call_regs(session, &[None; 16]);
    case.io.run_with_cpu_out_capture(bytes.len(), || {
        let init = session.call("g_hshk_initiate_send", opts.clone())?;
        assert_eq!(init.registers[2], HSHK_OK);
        for b in bytes {
            let sent = session.call(
                "g_hshk_send_byte",
                call_regs(session, &{
                    let mut o = [None; 16];
                    o[2] = Some(u16::from(*b));
                    o[6] = Some(0x6666);
                    o[7] = Some(0x7777);
                    o[8] = Some(session.return_stub_addr());
                    o[9] = Some(0x9999);
                    o
                }),
            )?;
            assert_eq!(sent.registers[2], HSHK_OK);
        }
        let fin = session.call("g_hshk_finalize_send", opts)?;
        assert_eq!(fin.registers[2], HSHK_OK);
        Ok(())
    })
}

pub fn io_to_cpu_bytes(case: &mut HandshakeCase, bytes: &[u8]) -> Result<Vec<u8>, FrameworkError> {
    use std::time::{Duration, Instant};

    let io = Arc::clone(&case.io);
    let payload = bytes.to_vec();
    let feeder = std::thread::spawn(move || {
        let mut poll = || std::thread::yield_now();
        io.exchange_with_cpu(&payload, 0, &mut poll)
    });

    let start = Instant::now();
    loop {
        if case
            .io
            .cru
            .lock()
            .expect("cru lock")
            .io_read_signal(CPU_IN_HSHK_IN_REQ)
            .unwrap_or(0)
            != 0
        {
            break;
        }
        if start.elapsed() > Duration::from_millis(5000) {
            return Err(FrameworkError::invalid_argument("timeout waiting IN_REQ"));
        }
        std::thread::yield_now();
    }

    let session = &mut case.session;
    let opts = call_regs(session, &[None; 16]);
    let wait = session.call("g_hshk_wait_req1_1", opts.clone())?;
    assert_eq!(wait.registers[2], HSHK_OK);
    let acc = session.call("g_hshk_accept_request", opts.clone())?;
    assert_eq!(acc.registers[2], HSHK_OK);

    let mut got = Vec::with_capacity(bytes.len());
    for _ in 0..bytes.len() {
        let rec = session.call("g_hshk_recv_byte", opts.clone())?;
        assert_eq!(rec.registers[2], HSHK_OK);
        got.push((rec.registers[3] & 0xff) as u8);
    }
    let fin = session.call("g_hshk_finalize_recv", opts)?;
    assert_eq!(fin.registers[2], HSHK_OK);
    let _ = feeder
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io feeder panicked"))??;
    Ok(got)
}

pub fn cru_set_out_dena(case: &HandshakeCase, value: u8) {
    case
        .io
        .cru
        .lock()
        .expect("cru lock")
        .cpu_write_signal(CPU_OUT_HSHK_OUT_DENA, value)
        .expect("set OUT_DENA");
}

pub fn cru_set_in_req(case: &HandshakeCase, value: u8) {
    case
        .io
        .cru
        .lock()
        .expect("cru lock")
        .io_write_signal(CPU_IN_HSHK_IN_REQ, value)
        .expect("set IN_REQ");
}
