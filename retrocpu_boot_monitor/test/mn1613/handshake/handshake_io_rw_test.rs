use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

fn base_regs() -> CallRegisters {
    CallRegisters {
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

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
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

#[test]
fn cmd_15h_read_io_returns_requested_bytes_plus_status() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let to_cpu = [0x15, 0x00, 0x00, 0xa0, 0x02, 0x00];
        let reply = mock.run_io_handler_exchange(&to_cpu, 3, || {
            let _ = s.call(
                "g_handshake_interrupt_handler",
                CallOptions {
                    registers: Some(base_regs()),
                    ..Default::default()
                },
            )?;
            Ok(())
        })?;
        assert_eq!(reply.len(), 3);
        assert_eq!(reply[2], 0);
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
