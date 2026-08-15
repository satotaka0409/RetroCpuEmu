/**
 * 画面用のデバッグ状態型とモック初期値。
 * 根拠: retrocpu_debug.mdc
 * 比較器はスロット 0–7 の 1 プール（命令／MEM／IO）。モック UI は当面
 * 命令リストとアドレスリストを分けて各 8 件出す。
 */

/** レジスタ一式（MN1613。表示用） */
export type RegisterSnapshot = {
  time: string;
  R0: string;
  R1: string;
  R2: string;
  R3: string;
  R4: string;
  IC: string;
  SP: string;
  STR: string;
  CSBR: string;
  SSBR: string;
  TSR0: string;
  TSR1: string;
  NPP: string;
  IISR: string;
  stack: string[];
};

/** 命令ブレイク履歴 1 件 */
export type InstrBreakHist = {
  slot: number;
  histIndex: number;
  regs: RegisterSnapshot;
};

/** アドレス（メモリ/IO）ブレイク履歴 1 件 */
export type AddrBreakHist = {
  slot: number;
  histIndex: number;
  kind: "MEM" | "IO";
  access: "READ" | "WRITE" | "R/W";
  condition: string;
  value: string;
  prevWrite: string;
  regs: RegisterSnapshot;
};

/** 逆アセンブル 1 行 */
export type DisasmLine = {
  addr: string;
  bytes: string;
  text: string;
  current?: boolean;
  bp?: boolean;
};

/** メモリダンプ 1 行（16 ワード想定の hex） */
export type MemDumpRow = {
  addr: string;
  words: string[];
};

/** デバッグ画面の初期モック */
export type DebugViewState = {
  title: string;
  sourcePath: string;
  sourceLines: string[];
  sourceFocusLine: number;
  disasm: DisasmLine[];
  memDump: MemDumpRow[];
  bpInstr: { slot: number; addr: string; enabled: boolean }[];
  bpAddr: {
    slot: number;
    kind: "MEM" | "IO";
    addr: string;
    access: string;
    enabled: boolean;
  }[];
  current: RegisterSnapshot;
  instrHistory: InstrBreakHist[];
  addrHistory: AddrBreakHist[];
  /** 表示中: 現在 / 命令履歴 / アドレス履歴 */
  viewMode: "current" | "instr" | "addr";
  histIndex: number;
  pointSlot: number;
};

/**
 * 16 進 4 桁に揃える。
 * @param n 数値
 * @returns 大文字 4 桁
 */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * サンプル用レジスタを作る。
 * @param seed 差分用
 * @returns スナップショット
 */
function makeRegs(seed: number): RegisterSnapshot {
  const stack: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    stack.push(hex4(0xff80 + i + seed));
  }
  return {
    time: String(123456789 + seed * 1000),
    R0: hex4(0x1000 + seed),
    R1: hex4(0x2000 + seed),
    R2: hex4(0x0000),
    R3: hex4(0x3000 + seed),
    R4: hex4(0x4000 + seed),
    IC: hex4(0x3456 + seed),
    SP: "FF80",
    STR: "8080",
    CSBR: "2",
    SSBR: "0",
    TSR0: "0",
    TSR1: "0",
    NPP: "100",
    IISR: "0",
    stack,
  };
}

/**
 * 画面シェル用の初期モック状態を返す。
 * @returns DebugViewState
 */
export function createMockDebugState(): DebugViewState {
  const current = makeRegs(0);
  const instrHistory: InstrBreakHist[] = [];
  for (let h = 0; h < 8; h += 1) {
    instrHistory.push({
      slot: 1,
      histIndex: h,
      regs: makeRegs(h + 1),
    });
  }
  const addrHistory: AddrBreakHist[] = [];
  for (let h = 0; h < 4; h += 1) {
    addrHistory.push({
      slot: 0,
      histIndex: h,
      kind: "MEM",
      access: "WRITE",
      condition: "=4000",
      value: hex4(0x8000 - h * 0x10),
      prevWrite: "4000",
      regs: makeRegs(10 + h),
    });
  }

  return {
    title: "MN1613 Debug（モック）",
    sourcePath: "sample.asm",
    sourceFocusLine: 4,
    sourceLines: [
      "\t.cpu\tmn1613",
      "\t.area\t_CODE\t(REL,CON)",
      "gl_main:",
      "\tmvwi\tR0, #0x1000",
      "\tai\tR0, #1\t\t; @cp sample_ai",
      "\tst\tR0, *0x40",
      "\tbald\tgl_main",
      "\th",
    ],
    disasm: [
      {
        addr: "1800",
        bytes: "7807 1000",
        text: "MVWI R0, #0x1000",
        bp: true,
      },
      { addr: "1802", bytes: "4801", text: "AI R0, #1", current: true },
      { addr: "1803", bytes: "8040", text: "ST R0, *0x40" },
      { addr: "1804", bytes: "2617 1800", text: "BALD 0x1800" },
      { addr: "1806", bytes: "2000", text: "H" },
    ],
    memDump: (() => {
      const rows: MemDumpRow[] = [];
      for (let a = 0x1800; a < 0x1840; a += 8) {
        const words: string[] = [];
        for (let i = 0; i < 8; i += 1) {
          words.push(hex4(0x7807 + ((a + i) & 0xff)));
        }
        rows.push({ addr: hex4(a), words });
      }
      return rows;
    })(),
    bpInstr: [
      { slot: 0, addr: "1800", enabled: true },
      { slot: 1, addr: "----", enabled: false },
      { slot: 2, addr: "----", enabled: false },
      { slot: 3, addr: "----", enabled: false },
      { slot: 4, addr: "----", enabled: false },
      { slot: 5, addr: "----", enabled: false },
      { slot: 6, addr: "----", enabled: false },
      { slot: 7, addr: "----", enabled: false },
    ],
    bpAddr: [
      {
        slot: 0,
        kind: "MEM",
        addr: "0040",
        access: "WRITE",
        enabled: true,
      },
      {
        slot: 1,
        kind: "IO",
        addr: "0022",
        access: "R/W",
        enabled: false,
      },
      {
        slot: 2,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
      {
        slot: 3,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
      {
        slot: 4,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
      {
        slot: 5,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
      {
        slot: 6,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
      {
        slot: 7,
        kind: "MEM",
        addr: "----",
        access: "-",
        enabled: false,
      },
    ],
    current,
    instrHistory,
    addrHistory,
    viewMode: "current",
    histIndex: 0,
    pointSlot: 1,
  };
}
