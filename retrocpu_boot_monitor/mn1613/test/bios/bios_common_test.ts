/**
 * g_rnd_init / g_get_rnd / g_mem_cpy / g_malloc_init / g_malloc / g_free
 * / g_malloc2_init / g_malloc2 / g_free2（bios_common.asm）
 * 根拠: boot_monitor.mdc / test_framework.mdc
 */
import {
  getState,
  setState,
} from "../../../../retrocpu_emu/src/cpuboard/mn1613/mn1613.js";
import {
  createSessionFromSettings,
  expect,
  test,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import { mn1613MonSettings, withMn1613CpuLog } from "../mn1613_mon_settings.js";

/** テスト用ヒープ先頭（ユーザ領域・CSBR=0） */
const HEAP_START = 0x1800;

/** malloc2 用論理先頭（SBR=4 なら物理 0x11800） */
const HEAP2_LOG = 0x1800;

/** malloc2 用 SBR（下位 2bit=0。有効値 0/4/8/C） */
const HEAP2_SBR = 4;

/**
 * 論理アドレスと SBR から 18bit 物理ワードアドレスを求める。
 * @param logAddr 論理ワードアドレス（16bit）
 * @param sbr セグメント（下位 4bit）
 * @returns 物理ワードアドレス
 */
function physWord(logAddr: number, sbr: number): number {
  return (((sbr & 0xf) << 14) + (logAddr & 0xffff)) & 0x3ffff;
}

/** ブロックヘッダ（サイズ＋フラグ） */
const HEAP_HDR = 2;

/** 使用中フラグ */
const HEAP_USED = 1;

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

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonSettings, import.meta.url),
);

/**
 * g_main 済みで 1 ケースを実行する（ハンドシェイク不要）。
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
 * 種から LFSR を count 歩進め、各歩の乱数値を返す。
 * @param seed 初期種（16bit）
 * @param count 歩数
 * @returns 各歩の乱数値（長さ count）
 */
function lfsrSequence(seed: number, count: number): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < count; i += 1) {
    x = lfsrStep(x);
    out.push(x);
  }
  return out;
}

/**
 * `_SYS_PAGE0` の種を読む。
 * @param s セッション
 * @returns 16bit 種
 */
function readSeed(s: Mn1613AsmSession): number {
  return s.readWord(s.wordAddr("GL_RND_SEED"));
}

test("g_rnd_init(0) はロック回避で種を 1 にする", async () => {
  await withCase(async (s) => {
    const r = await s.call("g_rnd_init", {
      registers: { ...BASE_REGS, R0: 0 },
    });
    expect(r.registers.R[0]).toBe(1);
    expect(readSeed(s)).toBe(1);
    s.expectRegisters({ R1: 0x1111, R3: 0x3333, R4: 0x4444 });
  });
});

test("g_rnd_init は非零の種をそのまま書く", async () => {
  await withCase(async (s) => {
    const r = await s.call("g_rnd_init", {
      registers: { ...BASE_REGS, R0: 0xabcd },
    });
    expect(r.registers.R[0]).toBe(0xabcd);
    expect(readSeed(s)).toBe(0xabcd);
    s.expectRegisters({ R1: 0x1111, R3: 0x3333, R4: 0x4444 });
  });
});

test("g_get_rnd は M系列 1 歩と一致し種も更新する", async () => {
  await withCase(async (s) => {
    await s.call("g_rnd_init", {
      registers: { ...BASE_REGS, R0: GL_RND_DEFAULT_SEED },
    });
    const expected = lfsrStep(GL_RND_DEFAULT_SEED);
    const r = await s.call("g_get_rnd", { registers: { ...BASE_REGS } });
    expect(r.registers.R[0]).toBe(expected);
    expect(readSeed(s)).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(1);
  });
});

test("g_get_rnd を 10 回呼び、TS 側 LFSR とすべて一致する", async () => {
  await withCase(async (s) => {
    s.setCpuLogMode("instruction");
    try {
      await s.call("g_rnd_init", {
        registers: { ...BASE_REGS, R0: GL_RND_DEFAULT_SEED },
      });
      const expected = lfsrSequence(GL_RND_DEFAULT_SEED, 10);
      const actual: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const r = await s.call("g_get_rnd", { registers: { ...BASE_REGS } });
        actual.push(r.registers.R[0]!);
      }
      expect(actual).toEqual(expected);
      expect(readSeed(s)).toBe(expected[9]);
    } finally {
      s.setCpuLogMode(null);
    }
  });
});

test("メモリ上の種 0 でも g_get_rnd は 1 から進める", async () => {
  await withCase(async (s) => {
    s.writeWord(s.wordAddr("GL_RND_SEED"), 0);
    const expected = lfsrStep(0);
    const r = await s.call("g_get_rnd", { registers: { ...BASE_REGS } });
    expect(r.registers.R[0]).toBe(expected);
    expect(readSeed(s)).toBe(expected);
    expect(expected).toBe(0xb400);
  });
});

test("R1–R4 は g_get_rnd の前後で保たれる", async () => {
  await withCase(async (s) => {
    await s.call("g_get_rnd", { registers: { ...BASE_REGS } });
    s.expectRegisters({ R1: 0x1111, R3: 0x3333, R4: 0x4444 });
  });
});

/** 同一セグメント内コピーの元（ユーザ領域） */
const CPY_SRC = 0x1800;

/** 同一セグメント内コピーの先 */
const CPY_DST = 0x1900;

/** コピーするワード列 */
const CPY_WORDS = [0x1111, 0x2222, 0x3333, 0x4444] as const;

test("g_mem_cpy は同一セグメントの語列をコピーする", async () => {
  await withCase(async (s) => {
    for (let i = 0; i < CPY_WORDS.length; i += 1) {
      s.writeWord(CPY_SRC + i, CPY_WORDS[i]!);
      s.writeWord(CPY_DST + i, 0xdead);
    }
    await s.call("g_mem_cpy", {
      registers: {
        ...BASE_REGS,
        R0: 0,
        R1: CPY_SRC,
        R2: CPY_WORDS.length,
      },
      stack: [CPY_DST, 0],
    });
    s.expectMemoryWords(CPY_DST, [...CPY_WORDS]);
    s.expectMemoryWords(CPY_SRC, [...CPY_WORDS]);
  });
});

test("g_mem_cpy は語数 0 なら先を変えない", async () => {
  await withCase(async (s) => {
    s.writeWord(CPY_SRC, 0xcafe);
    s.writeWord(CPY_DST, 0xdead);
    await s.call("g_mem_cpy", {
      registers: { ...BASE_REGS, R0: 0, R1: CPY_SRC, R2: 0 },
      stack: [CPY_DST, 0],
    });
    expect(s.readWord(CPY_DST)).toBe(0xdead);
  });
});

test("g_mem_cpy はセグメントをまたいでコピーする", async () => {
  await withCase(async (s) => {
    const dstPhys = physWord(HEAP2_LOG, HEAP2_SBR);
    for (let i = 0; i < CPY_WORDS.length; i += 1) {
      s.writeWord(CPY_SRC + i, CPY_WORDS[i]!);
      s.writeWord(dstPhys + i, 0xdead);
    }
    await s.call("g_mem_cpy", {
      registers: {
        ...BASE_REGS,
        R0: 0,
        R1: CPY_SRC,
        R2: CPY_WORDS.length,
      },
      stack: [HEAP2_LOG, HEAP2_SBR >> 2],
    });
    s.expectMemoryWords(dstPhys, [...CPY_WORDS]);
    s.expectMemoryWords(CPY_SRC, [...CPY_WORDS]);
  });
});

/**
 * 18bit 物理ワードアドレスを g_mem_cpy の A16–A17 と論理アドレスに分ける。
 * @param phys 物理ワードアドレス
 * @returns a17 は phys[17:16]（0–3）、log は下位 16bit
 */
function physToCpyArgs(phys: number): { a17: number; log: number } {
  const p = phys & 0x3ffff;
  return { a17: (p >>> 16) & 3, log: p & 0xffff };
}

/**
 * 指定物理アドレス間で CPY_WORDS をコピーして検証する。
 * @param s セッション
 * @param srcPhys 元の物理ワードアドレス
 * @param dstPhys 先の物理ワードアドレス
 */
async function expectMemCpyPhys(
  s: Mn1613AsmSession,
  srcPhys: number,
  dstPhys: number,
): Promise<void> {
  const src = physToCpyArgs(srcPhys);
  const dst = physToCpyArgs(dstPhys);
  for (let i = 0; i < CPY_WORDS.length; i += 1) {
    s.writeWord(srcPhys + i, CPY_WORDS[i]!);
    s.writeWord(dstPhys + i, 0xdead);
  }
  await s.call("g_mem_cpy", {
    registers: {
      ...BASE_REGS,
      R0: src.a17,
      R1: src.log,
      R2: CPY_WORDS.length,
    },
    stack: [dst.log, dst.a17],
  });
  s.expectMemoryWords(dstPhys, [...CPY_WORDS]);
  s.expectMemoryWords(srcPhys, [...CPY_WORDS]);
}

test("g_mem_cpy は 0x20000 から 0x38000 へコピーする", async () => {
  await withCase(async (s) => {
    await expectMemCpyPhys(s, 0x20000, 0x38000);
  });
});

test("g_mem_cpy は 0x3F000 から 0x0E000 へコピーする", async () => {
  await withCase(async (s) => {
    await expectMemCpyPhys(s, 0x3f000, 0x0e000);
  });
});

test("R3/R4 と TSR0/TSR1 は g_mem_cpy の前後で保たれる", async () => {
  await withCase(async (s) => {
    s.writeWord(CPY_SRC, 0x0001);
    setState({ TSR0: 0x8, TSR1: 0xc });
    await s.call("g_mem_cpy", {
      registers: {
        ...BASE_REGS,
        R0: 0,
        R1: CPY_SRC,
        R2: 1,
      },
      stack: [CPY_DST, 0],
    });
    s.expectRegisters({ R3: 0x3333, R4: 0x4444 });
    expect(getState().TSR0 & 0xf).toBe(0x8);
    expect(getState().TSR1 & 0xf).toBe(0xc);
  });
});

test("g_malloc_init は範囲と空きヘッダを書く", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc_init", {
      registers: { ...BASE_REGS, R0: HEAP_START, R1: 16 },
    });
    expect(s.readWord(s.wordAddr("GL_ALLOC_ADR"))).toBe(HEAP_START);
    expect(s.readWord(s.wordAddr("GL_ALLOC_SIZE"))).toBe(16);
    expect(s.readWord(HEAP_START)).toBe(16);
    expect(s.readWord(HEAP_START + 1)).toBe(0);
    s.expectRegisters({ R0: HEAP_START, R1: 16, R4: 0x4444 });
  });
});

test("g_malloc はヘッダの後ろを返しブロックを分割する", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc_init", {
      registers: { R0: HEAP_START, R1: 16 },
    });
    const a = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 4 },
    });
    expect(a.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
    expect(s.readWord(HEAP_START)).toBe(4 + HEAP_HDR);
    expect(s.readWord(HEAP_START + 1)).toBe(HEAP_USED);
    expect(s.readWord(HEAP_START + 6)).toBe(10);
    expect(s.readWord(HEAP_START + 7)).toBe(0);
    const b = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 8 },
    });
    expect(b.registers.R[0]).toBe(HEAP_START + 8);
    expect(s.readWord(HEAP_START + 6)).toBe(10);
    expect(s.readWord(HEAP_START + 7)).toBe(HEAP_USED);
    expect(s.readWord(s.wordAddr("GL_ALLOC_ADR"))).toBe(HEAP_START);
    expect(s.readWord(s.wordAddr("GL_ALLOC_SIZE"))).toBe(16);
  });
});

test("g_malloc は残り不足・サイズ 0・未初期化で 0 を返す", async () => {
  await withCase(async (s) => {
    s.writeWord(s.wordAddr("GL_ALLOC_SIZE"), 0);
    const uninit = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 1 },
    });
    expect(uninit.registers.R[0]).toBe(0);
    await s.call("g_malloc_init", {
      registers: { R0: HEAP_START, R1: 5 },
    });
    const zero = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 0 },
    });
    expect(zero.registers.R[0]).toBe(0);
    const big = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 4 },
    });
    expect(big.registers.R[0]).toBe(0);
    const exact = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 3 },
    });
    expect(exact.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
    expect(s.readWord(HEAP_START)).toBe(5);
    expect(s.readWord(HEAP_START + 1)).toBe(HEAP_USED);
  });
});

test("g_free はブロックを返し結合後に再確保できる", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc_init", {
      registers: { R0: HEAP_START, R1: 16 },
    });
    const a = await s.call("g_malloc", { registers: { R0: 4 } });
    const b = await s.call("g_malloc", { registers: { R0: 4 } });
    expect(a.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
    expect(b.registers.R[0]).toBe(HEAP_START + 8);
    const fa = await s.call("g_free", {
      registers: { ...BASE_REGS, R0: a.registers.R[0] },
    });
    expect(fa.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
    const reuse = await s.call("g_malloc", { registers: { R0: 4 } });
    expect(reuse.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
    await s.call("g_free", { registers: { R0: reuse.registers.R[0] } });
    await s.call("g_free", { registers: { R0: b.registers.R[0] } });
    expect(s.readWord(HEAP_START)).toBe(16);
    expect(s.readWord(HEAP_START + 1)).toBe(0);
    const big = await s.call("g_malloc", { registers: { R0: 12 } });
    expect(big.registers.R[0]).toBe(HEAP_START + HEAP_HDR);
  });
});

test("g_free は 0・二重解放・未登録で 0 を返す", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc_init", {
      registers: { R0: HEAP_START, R1: 16 },
    });
    const z = await s.call("g_free", {
      registers: { ...BASE_REGS, R0: 0 },
    });
    expect(z.registers.R[0]).toBe(0);
    const bad = await s.call("g_free", {
      registers: { ...BASE_REGS, R0: HEAP_START + 4 },
    });
    expect(bad.registers.R[0]).toBe(0);
    const p = await s.call("g_malloc", { registers: { R0: 3 } });
    await s.call("g_free", { registers: { R0: p.registers.R[0] } });
    const dup = await s.call("g_free", {
      registers: { ...BASE_REGS, R0: p.registers.R[0] },
    });
    expect(dup.registers.R[0]).toBe(0);
  });
});

test("R3/R4 は g_malloc / g_free の前後で保たれる", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc_init", {
      registers: { R0: HEAP_START, R1: 8 },
    });
    const p = await s.call("g_malloc", {
      registers: { ...BASE_REGS, R0: 2 },
    });
    s.expectRegisters({ R3: 0x3333, R4: 0x4444 });
    await s.call("g_free", {
      registers: { ...BASE_REGS, R0: p.registers.R[0] },
    });
    s.expectRegisters({ R3: 0x3333, R4: 0x4444 });
  });
});

test("g_malloc2_init は範囲・SBR と空きヘッダを書く", async () => {
  await withCase(async (s) => {
    const phys = physWord(HEAP2_LOG, HEAP2_SBR);
    await s.call("g_malloc2_init", {
      registers: { ...BASE_REGS, R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 16 },
    });
    expect(s.readWord(s.wordAddr("GL_ALLOC2_ADR"))).toBe(HEAP2_LOG);
    expect(s.readWord(s.wordAddr("GL_ALLOC2_SBR"))).toBe(HEAP2_SBR);
    expect(s.readWord(s.wordAddr("GL_ALLOC2_SIZE"))).toBe(16);
    expect(s.readWord(phys)).toBe(16);
    expect(s.readWord(phys + 1)).toBe(0);
    s.expectRegisters({ R0: HEAP2_LOG, R1: HEAP2_SBR,
      R3: 0x3333,
      R4: 0x4444,
    });
  });
});

test("g_malloc2_init は SBR 下位 2bit を 0 にマスクする", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc2_init", {
      registers: { ...BASE_REGS, R0: HEAP2_LOG, R1: 0x5, R2: 16 },
    });
    expect(s.readWord(s.wordAddr("GL_ALLOC2_SBR"))).toBe(0x4);
  });
});

test("g_malloc2 はヘッダの後ろと SBR を返しブロックを分割する", async () => {
  await withCase(async (s) => {
    const phys = physWord(HEAP2_LOG, HEAP2_SBR);
    await s.call("g_malloc2_init", {
      registers: { R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 16 },
    });
    const a = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 4 },
    });
    expect(a.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(a.registers.R[1]).toBe(HEAP2_SBR);
    expect(s.readWord(phys)).toBe(4 + HEAP_HDR);
    expect(s.readWord(phys + 1)).toBe(HEAP_USED);
    expect(s.readWord(phys + 6)).toBe(10);
    expect(s.readWord(phys + 7)).toBe(0);
    const b = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 8 },
    });
    expect(b.registers.R[0]).toBe(HEAP2_LOG + 8);
    expect(b.registers.R[1]).toBe(HEAP2_SBR);
    expect(s.readWord(phys + 6)).toBe(10);
    expect(s.readWord(phys + 7)).toBe(HEAP_USED);
  });
});

test("g_malloc2 は残り不足・サイズ 0・未初期化で 0 を返す", async () => {
  await withCase(async (s) => {
    s.writeWord(s.wordAddr("GL_ALLOC2_SIZE"), 0);
    const uninit = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 1 },
    });
    expect(uninit.registers.R[0]).toBe(0);
    expect(uninit.registers.R[1]).toBe(0);
    await s.call("g_malloc2_init", {
      registers: { R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 5 },
    });
    const zero = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 0 },
    });
    expect(zero.registers.R[0]).toBe(0);
    expect(zero.registers.R[1]).toBe(0);
    const big = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 4 },
    });
    expect(big.registers.R[0]).toBe(0);
    const exact = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 3 },
    });
    expect(exact.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(exact.registers.R[1]).toBe(HEAP2_SBR);
    const phys = physWord(HEAP2_LOG, HEAP2_SBR);
    expect(s.readWord(phys)).toBe(5);
    expect(s.readWord(phys + 1)).toBe(HEAP_USED);
  });
});

test("g_free2 はブロックを返し結合後に再確保できる", async () => {
  await withCase(async (s) => {
    const phys = physWord(HEAP2_LOG, HEAP2_SBR);
    await s.call("g_malloc2_init", {
      registers: { R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 16 },
    });
    const a = await s.call("g_malloc2", { registers: { R0: 4 } });
    const b = await s.call("g_malloc2", { registers: { R0: 4 } });
    expect(a.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(b.registers.R[0]).toBe(HEAP2_LOG + 8);
    const fa = await s.call("g_free2", {
      registers: {
        ...BASE_REGS,
        R0: a.registers.R[0],
        R1: a.registers.R[1],
      },
    });
    expect(fa.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(fa.registers.R[1]).toBe(HEAP2_SBR);
    const reuse = await s.call("g_malloc2", { registers: { R0: 4 } });
    expect(reuse.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(reuse.registers.R[1]).toBe(HEAP2_SBR);
    await s.call("g_free2", {
      registers: { R0: reuse.registers.R[0], R1: reuse.registers.R[1] },
    });
    await s.call("g_free2", {
      registers: { R0: b.registers.R[0], R1: b.registers.R[1] },
    });
    expect(s.readWord(phys)).toBe(16);
    expect(s.readWord(phys + 1)).toBe(0);
    const big = await s.call("g_malloc2", { registers: { R0: 12 } });
    expect(big.registers.R[0]).toBe(HEAP2_LOG + HEAP_HDR);
    expect(big.registers.R[1]).toBe(HEAP2_SBR);
  });
});

test("g_free2 は 0・SBR 不一致・二重解放で 0 を返す", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc2_init", {
      registers: { R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 16 },
    });
    const z = await s.call("g_free2", {
      registers: { ...BASE_REGS, R0: 0, R1: HEAP2_SBR },
    });
    expect(z.registers.R[0]).toBe(0);
    expect(z.registers.R[1]).toBe(0);
    const p = await s.call("g_malloc2", { registers: { R0: 3 } });
    const wrongSbr = await s.call("g_free2", {
      registers: { ...BASE_REGS, R0: p.registers.R[0], R1: 0 },
    });
    expect(wrongSbr.registers.R[0]).toBe(0);
    expect(wrongSbr.registers.R[1]).toBe(0);
    await s.call("g_free2", {
      registers: { R0: p.registers.R[0], R1: p.registers.R[1] },
    });
    const dup = await s.call("g_free2", {
      registers: { ...BASE_REGS, R0: p.registers.R[0], R1: p.registers.R[1] },
    });
    expect(dup.registers.R[0]).toBe(0);
    expect(dup.registers.R[1]).toBe(0);
  });
});

test("R3/R4 は g_malloc2 / g_free2 の前後で保たれる", async () => {
  await withCase(async (s) => {
    await s.call("g_malloc2_init", {
      registers: { R0: HEAP2_LOG, R1: HEAP2_SBR, R2: 8 },
    });
    const p = await s.call("g_malloc2", {
      registers: { ...BASE_REGS, R0: 2 },
    });
    s.expectRegisters({ R3: 0x3333, R4: 0x4444 });
    await s.call("g_free2", {
      registers: {
        ...BASE_REGS,
        R0: p.registers.R[0],
        R1: p.registers.R[1],
      },
    });
    s.expectRegisters({ R3: 0x3333, R4: 0x4444 });
  });
});
