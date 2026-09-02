//! Ported from `interrupt_undef_test.ts` — INT0 未定義命令と GL_UNDEF_INST_REG 退避。

use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CodeTestIoMockEntry, FrameworkError, IoBoardHandshakeMock,
    JsonTestSettings, Mn1613AsmSession, Mn1613CpuRegisterPatch as CpuRegisterPatch,
    Mn1613ExecStatus,
};

const UNDEF_WORD_ADDR: u16 = 0x1800;
const UNDEF_OPCODE: u16 = 0x0000;
const PRE_R: [u16; 5] = [0x1111, 0x2222, 0x3333, 0x4444, 0x5555];
const PRE_SP: u16 = 0xff00;
const PRE_STR: u16 = 0x0700;
const PRE_CSBR: u8 = 0x4;
const PRE_SSBR: u8 = 0x0;
const PRE_TSR0: u8 = 0xc;
const PRE_TSR1: u8 = 0x4;
const PRE_NPP: u8 = 0x01;
const HSHK_REG_WORDS: usize = 11;

fn handshake_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession, Arc<IoBoardHandshakeMock>) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(&handshake_settings(), None)?;
    s.reload()?;
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn phys_word(log_addr: u16, sbr: u16) -> u32 {
    (((sbr & 0x0f) as u32) << 14) + log_addr as u32
}

fn pack_hl(hi: u16, lo: u16) -> u16 {
    ((hi & 0xff) << 8) | (lo & 0xff)
}

fn run_undef_until_main_loop(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<(), FrameworkError> {
    s.write_word_phys(phys_word(UNDEF_WORD_ADDR, PRE_CSBR as u16), UNDEF_OPCODE);
    s.set_cpu_state(&CpuRegisterPatch {
        r: Some([
            Some(PRE_R[0]),
            Some(PRE_R[1]),
            Some(PRE_R[2]),
            Some(PRE_R[3]),
            Some(PRE_R[4]),
        ]),
        sp: Some(PRE_SP),
        str: Some(PRE_STR),
        csbr: Some(PRE_CSBR),
        ssbr: Some(PRE_SSBR),
        tsr0: Some(PRE_TSR0),
        tsr1: Some(PRE_TSR1),
        npp: Some(PRE_NPP),
        iisr: Some(0),
        ..Default::default()
    });

    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || {
        let mut poll = || std::thread::yield_now();
        io.handle_one_request(&mut poll)
    });

    let status = s.run(UNDEF_WORD_ADDR)?;
    worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;

    assert_eq!(status, Mn1613ExecStatus::Halted);
    Ok(())
}

#[test]
fn undef_int0_clears_iisr_bit15_and_sets_undef_led() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        run_undef_until_main_loop(s, &mock)?;
        let st = s.cpu_state();
        assert_eq!(st.iisr & 0x0001, 0);
        assert!(mock.undef_led());
        let ic = st.ic & 0xffff;
        assert_eq!(s.read_word(ic.wrapping_sub(1)), 0x2000);
        Ok(())
    })
}

#[test]
fn undef_saves_registers_to_gl_undef_inst_reg() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        run_undef_until_main_loop(s, &mock)?;

        assert_eq!(s.read_word(0), PRE_STR);
        assert_eq!(s.read_word(1), UNDEF_WORD_ADDR.wrapping_add(1));

        let expected = [
            PRE_R[0],
            PRE_R[1],
            PRE_R[2],
            PRE_R[3],
            PRE_R[4],
            PRE_SP,
            PRE_STR,
            UNDEF_WORD_ADDR.wrapping_add(1),
            pack_hl(PRE_CSBR as u16, PRE_SSBR as u16),
            pack_hl(PRE_TSR0 as u16, PRE_TSR1 as u16),
            (PRE_NPP as u16) << 8,
        ];
        assert_eq!(expected.len(), HSHK_REG_WORDS);
        s.expect_label_words("GL_UNDEF_INST_REG", &expected)
    })
}
