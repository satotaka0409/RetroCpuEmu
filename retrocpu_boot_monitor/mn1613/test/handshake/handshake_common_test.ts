/**
 * handshake_common.asm（線制御: initiate / send / recv / finalize）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import { mn1613MonHandshakeSettings } from "../mn1613_mon_settings.js";

const HSHK_OK = 0x00;
const HSHK_NG = 0x01;

/** ゼロページ GL_HSHK_RECV_DATA（handshake_io.inc） */
const GL_HSHK_RECV_DATA = 0x0009;

/** ゼロページ GL_RND_SEED（bios_common.asm） */
const GL_RND_SEED_WORD = 0x0008;

const BASE_REGS = {
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

const SAVED = { R2: 0x2222, R3: 0x3333, R4: 0x4444 } as const;

const session: Mn1613AsmSession = createSessionFromSettings(
  mn1613MonHandshakeSettings,
);

/**
 * gl_main 済み＋ ioMock handshake で 1 ケースを実行する。
 * @param fn 本体（session / mock 利用可）
 */
async function withCase(
  fn: (s: Mn1613AsmSession, mock: IoBoardHandshakeMock) => Promise<void>,
): Promise<void> {
  session.reload();
  try {
    await session.runInit();
    await fn(session, session.requireHandshakeMock());
  } finally {
    await session.detachIoMock();
  }
}

/**
 * IO が HSHK_REQ_1 を上げるまで待つ。
 * @param mock IO モック
 * @param timeoutMs 上限 ms
 */
async function waitReq1(
  mock: IoBoardHandshakeMock,
  timeoutMs = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (mock.bus.HSHK_REQ_1 !== 1) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting HSHK_REQ_1");
    }
    await new Promise((r) => setTimeout(r, 1));
  }
}

/**
 * CPU→IO を initiate / send_byte×N / finalize で送り、IO が同じバイトを受け取る。
 * @param mock IO モック
 * @param bytes 送信バイト（各 0–255）
 * @returns IO が受信した列
 */
async function cpuToIoBytes(
  mock: IoBoardHandshakeMock,
  bytes: number[],
): Promise<Uint8Array> {
  const ioP = mock.io.receive(bytes.length);
  const cpuP = (async () => {
    const init = await session.call("gl_hshk_initiate_send", {
      registers: { ...BASE_REGS },
    });
    expect(init.registers.R[0]).toBe(HSHK_OK);
    for (const b of bytes) {
      const sent = await session.call("gl_hshk_send_byte", {
        registers: { ...BASE_REGS, R0: b & 0xff },
      });
      expect(sent.registers.R[0]).toBe(HSHK_OK);
    }
    const fin = await session.call("gl_hshk_finalize_send", {
      registers: { ...BASE_REGS },
    });
    expect(fin.registers.R[0]).toBe(HSHK_OK);
  })();
  const [received] = await Promise.all([ioP, cpuP]);
  return received;
}

/**
 * IO→CPU を送り、wait_req1_1 / accept / recv_byte×N / finalize で受け取る。
 * @param mock IO モック
 * @param bytes IO が送るバイト
 * @returns ゼロページに残った受信バイト列
 */
async function ioToCpuBytes(
  mock: IoBoardHandshakeMock,
  bytes: number[],
): Promise<number[]> {
  const ioP = mock.io.send(Uint8Array.from(bytes));
  await waitReq1(mock);
  const wait = await session.call("gl_hshk_wait_req1_1", {
    registers: { ...BASE_REGS },
  });
  expect(wait.registers.R[0]).toBe(HSHK_OK);
  const acc = await session.call("gl_hshk_accept_request", {
    registers: { ...BASE_REGS },
  });
  expect(acc.registers.R[0]).toBe(HSHK_OK);
  const got: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const rec = await session.call("gl_hshk_recv_byte", {
      registers: { ...BASE_REGS },
    });
    expect(rec.registers.R[0]).toBe(HSHK_OK);
    got.push(session.readWord(GL_HSHK_RECV_DATA) & 0xff);
  }
  const fin = await session.call("gl_hshk_finalize_recv", {
    registers: { ...BASE_REGS },
  });
  expect(fin.registers.R[0]).toBe(HSHK_OK);
  await ioP;
  return got;
}

test("CPU→IO 1 バイトが initiate / send / finalize で届く", async () => {
  await withCase(async (s, mock) => {
    const received = await cpuToIoBytes(mock, [0xa5]);
    expect(Array.from(received)).toEqual([0xa5]);
    expect(mock.bus.HSHK_ENA).toBe(0);
    expect(mock.bus.HSHK_REQ_0).toBe(0);
    s.expectRegisters({ R0: HSHK_OK, ...SAVED });
  });
});

test("CPU→IO 複数バイトが順に届く", async () => {
  await withCase(async (s, mock) => {
    const received = await cpuToIoBytes(mock, [0x19, 0x01, 0x64]);
    expect(Array.from(received)).toEqual([0x19, 0x01, 0x64]);
    s.expectRegisters({ R0: HSHK_OK, ...SAVED });
  });
});

test("ENA が 1 のままなら gl_hshk_initiate_send は NG", async () => {
  await withCase(async (s, mock) => {
    mock.bus.HSHK_ENA = 1;
    const r = await s.call("gl_hshk_initiate_send", {
      registers: { ...BASE_REGS },
    });
    expect(r.registers.R[0]).toBe(HSHK_NG);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("相手がいない gl_hshk_send_byte は DACK 待ちで NG", async () => {
  await withCase(async (s) => {
    const r = await s.call("gl_hshk_send_byte", {
      registers: { ...BASE_REGS, R0: 0x5a },
    });
    expect(r.registers.R[0]).toBe(HSHK_NG);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("IO→CPU 1 バイトが accept / recv / finalize で GL_HSHK_RECV_DATA に入る", async () => {
  await withCase(async (s, mock) => {
    const got = await ioToCpuBytes(mock, [0xc3]);
    expect(got).toEqual([0xc3]);
    expect(s.readWord(GL_HSHK_RECV_DATA) & 0xff).toBe(0xc3);
    expect(mock.bus.HSHK_ENA).toBe(0);
    expect(mock.bus.HSHK_REQ_1).toBe(0);
    s.expectRegisters({ R0: HSHK_OK, ...SAVED });
  });
});

test("IO→CPU 2 バイトを連続受信する", async () => {
  await withCase(async (s, mock) => {
    const got = await ioToCpuBytes(mock, [0x48, 0xab]);
    expect(got).toEqual([0x48, 0xab]);
    s.expectRegisters({ R0: HSHK_OK, ...SAVED });
  });
});

test("gl_hshk_wait_req1_1 は REQ_1=1 なら OK", async () => {
  await withCase(async (s, mock) => {
    mock.bus.HSHK_REQ_1 = 1;
    const r = await s.call("gl_hshk_wait_req1_1", {
      registers: { ...BASE_REGS },
    });
    expect(r.registers.R[0]).toBe(HSHK_OK);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("gl_hshk_wait_req1_1 は REQ_1 が来なければ NG", async () => {
  await withCase(async (s, mock) => {
    mock.bus.HSHK_REQ_1 = 0;
    const r = await s.call("gl_hshk_wait_req1_1", {
      registers: { ...BASE_REGS },
    });
    expect(r.registers.R[0]).toBe(HSHK_NG);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("gl_hshk_finalize_recv は ENA を落として OK を返す", async () => {
  await withCase(async (s, mock) => {
    mock.bus.HSHK_ENA = 1;
    const r = await s.call("gl_hshk_finalize_recv", {
      registers: { ...BASE_REGS },
    });
    expect(r.registers.R[0]).toBe(HSHK_OK);
    expect(mock.bus.HSHK_ENA).toBe(0);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("gl_hshk_wait_ena_delay は乱数種を進め R2–R4 を保つ", async () => {
  await withCase(async (s) => {
    const seedBefore = s.readWord(GL_RND_SEED_WORD);
    await s.call("gl_hshk_wait_ena_delay", { registers: { ...BASE_REGS } });
    const seedAfter = s.readWord(GL_RND_SEED_WORD);
    expect(seedAfter === seedBefore).toBe(false);
    expect(seedAfter).toBeGreaterThanOrEqual(1);
    s.expectRegisters({ R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});
