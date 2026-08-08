/**
 * gl_rnd_init / gl_get_rnd（bios_common.asm）
 * 根拠: boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
  expect,
  test,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import { mn1613MonSettings } from "../mn1613_mon_settings.js";

/** _SYS_PAGE0 の GL_RND_SEED（memmap.inc / bios_common.asm） */
const GL_RND_SEED_WORD = 0x0008;

/** Galois LFSR タップ（x^16+x^14+x^13+x^11+1） */
const GL_RND_TAP = 0xb400;

/** main.asm の GL_RND_DEFAULT_SEED */
const GL_RND_DEFAULT_SEED = 0x1234;

const BASE_REGS = {
  R1: 0x1111,
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

const session: Mn1613AsmSession = createSessionFromSettings(mn1613MonSettings);

/**
 * gl_main 済みで 1 ケースを実行する（ハンドシェイク不要）。
 * @param fn 本体
 */
async function withCase(
  fn: (s: Mn1613AsmSession) => Promise<void>,
): Promise<void> {
  session.reload();
  await session.runInit();
  await fn(session);
}

/**
 * bios_common.asm と同じ右シフト Galois LFSR を 1 歩進める。
 * @param seed 種（16bit。0 は 1 にする）
 * @returns 次の値（1〜0xFFFF）
 */
function lfsrStep(seed: number): number {
  let x = seed & 0xffff;
  if (x === 0) x = 1;
  const lsb = x & 1;
  x >>>= 1;
  if (lsb !== 0) x ^= GL_RND_TAP;
  return x & 0xffff;
}

/**
 * ゼロページの種を読む。
 * @param s セッション
 * @returns 16bit 種
 */
function readSeed(s: Mn1613AsmSession): number {
  return s.readWord(GL_RND_SEED_WORD);
}

test("gl_rnd_init(0) はロック回避で種を 1 にする", async () => {
  await withCase(async (s) => {
    const r = await s.call("gl_rnd_init", {
      registers: { ...BASE_REGS, R0: 0 },
    });
    expect(r.registers.R[0]).toBe(1);
    expect(readSeed(s)).toBe(1);
    s.expectRegisters({ R1: 0x1111, R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("gl_rnd_init は非零の種をそのまま書く", async () => {
  await withCase(async (s) => {
    const r = await s.call("gl_rnd_init", {
      registers: { ...BASE_REGS, R0: 0xabcd },
    });
    expect(r.registers.R[0]).toBe(0xabcd);
    expect(readSeed(s)).toBe(0xabcd);
    s.expectRegisters({ R1: 0x1111, R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});

test("gl_get_rnd は M系列 1 歩と一致し種も更新する", async () => {
  await withCase(async (s) => {
    await s.call("gl_rnd_init", {
      registers: { ...BASE_REGS, R0: GL_RND_DEFAULT_SEED },
    });
    const expected = lfsrStep(GL_RND_DEFAULT_SEED);
    const r = await s.call("gl_get_rnd", { registers: { ...BASE_REGS } });
    expect(r.registers.R[0]).toBe(expected);
    expect(readSeed(s)).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(1);
  });
});

test("gl_get_rnd を連続呼び出ししてもソフトモデルと一致し 0 にならない", async () => {
  await withCase(async (s) => {
    await s.call("gl_rnd_init", {
      registers: { ...BASE_REGS, R0: 0xace1 },
    });
    let seed = 0xace1;
    const seen = new Set<number>();
    for (let i = 0; i < 64; i += 1) {
      seed = lfsrStep(seed);
      const r = await s.call("gl_get_rnd", { registers: { ...BASE_REGS } });
      expect(r.registers.R[0]).toBe(seed);
      expect(readSeed(s)).toBe(seed);
      expect(seed).toBeGreaterThanOrEqual(1);
      seen.add(seed);
    }
    expect(seen.size).toBe(64);
  });
});

test("メモリ上の種 0 でも gl_get_rnd は 1 から進める", async () => {
  await withCase(async (s) => {
    s.writeWord(GL_RND_SEED_WORD, 0);
    const expected = lfsrStep(0);
    const r = await s.call("gl_get_rnd", { registers: { ...BASE_REGS } });
    expect(r.registers.R[0]).toBe(expected);
    expect(readSeed(s)).toBe(expected);
    expect(expected).toBe(0xb400);
  });
});

test("R1–R4 は gl_get_rnd の前後で保たれる", async () => {
  await withCase(async (s) => {
    await s.call("gl_get_rnd", { registers: { ...BASE_REGS } });
    s.expectRegisters({ R1: 0x1111, R2: 0x2222, R3: 0x3333, R4: 0x4444 });
  });
});
