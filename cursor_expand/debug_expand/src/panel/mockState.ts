/**
 * 画面用のデバッグ状態型とモック初期値。
 * 根拠: retrocpu_debug.mdc（比較器スロット 0–7 の 1 プール、INT3 廃止）
 */

/** 物理ワードアドレス幅（18bit → 表示は 16 進 5 桁） */
export const PHYS_WORD_MASK = 0x3ffff;

/** メモリダンプ 1 行あたりのワード数 */
export const MEM_WORDS_PER_ROW = 16;

/** リセット／モニタ開始ワード（CDB が無いときの仮） */
export const DEFAULT_ENTRY_WORD = 0x0108;

/** ダンプ取得窓（現在位置から ±800h ワード） */
export const MEM_WINDOW_HALF = 0x800;

/** スクロール再取得の余裕（ワード） */
export const MEM_REFETCH_MARGIN = 0x80;

/** 比較器の種類（UI。ハードは同一比較器） */
export type BpKind = "INST" | "MEM" | "IO";

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

/** 比較器スロット 1 本の一覧行 */
export type BpSlotView = {
  slot: number;
  kind: BpKind;
  addr: string;
  access: string;
  enabled: boolean;
  history: boolean;
};

/** スロット履歴 1 件（レジスタ＋値比較の表示用） */
export type SlotBreakHist = {
  slot: number;
  histIndex: number;
  kind: BpKind;
  access: string;
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

/** メモリダンプ 1 行（アドレス 5 桁、各ワード 4 桁） */
export type MemDumpRow = {
  addr: string;
  words: string[];
};

/** デバッグ画面の状態 */
export type DebugViewState = {
  title: string;
  sourcePath: string;
  sourceLines: string[];
  sourceFocusLine: number;
  disasm: DisasmLine[];
  memDump: MemDumpRow[];
  /** 表示の基準（スクロール／ジャンプ先）物理ワード */
  memStart: number;
  /** 取得済み窓の先頭物理ワード */
  memCacheLo: number;
  /** 取得済み窓の末尾物理ワード（含む） */
  memCacheHi: number;
  /** ダンプ取得の状態（未接続／handshake OK など） */
  memNote: string;
  bpSlots: BpSlotView[];
  current: RegisterSnapshot;
  slotHistory: SlotBreakHist[];
  /** 現在値か、選択スロットの履歴か */
  viewMode: "current" | "hist";
  histIndex: number;
  pointSlot: number;
};

/**
 * 16 進 4 桁に揃える（16bit データ／論理アドレス）。
 * @param n 数値
 * @returns 大文字 4 桁
 */
export function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * 16 進 5 桁に揃える（物理ワード 18bit）。
 * @param n 数値
 * @returns 大文字 5 桁
 */
export function hex5(n: number): string {
  return (n & PHYS_WORD_MASK).toString(16).toUpperCase().padStart(5, "0");
}

/**
 * 中心ワードの ±800h（行先頭に揃えた窓）を返す。
 * @param centerWord 基準物理ワード
 * @returns 先頭・末尾（含む）・語数
 */
export function memFetchRange(centerWord: number): {
  lo: number;
  hi: number;
  wordCount: number;
} {
  const c = centerWord & PHYS_WORD_MASK;
  let lo = c - MEM_WINDOW_HALF;
  let hi = c + MEM_WINDOW_HALF;
  if (lo < 0) lo = 0;
  if (hi > PHYS_WORD_MASK) hi = PHYS_WORD_MASK;
  lo &= ~(MEM_WORDS_PER_ROW - 1);
  let wordCount = hi - lo + 1;
  const rem = wordCount % MEM_WORDS_PER_ROW;
  if (rem !== 0) wordCount += MEM_WORDS_PER_ROW - rem;
  if (lo + wordCount - 1 > PHYS_WORD_MASK) {
    wordCount = PHYS_WORD_MASK - lo + 1;
  }
  return { lo, hi: lo + wordCount - 1, wordCount };
}

/**
 * 可視範囲がキャッシュ端に近づいたら再取得する。
 * @param viewLo 可視先頭ワード
 * @param viewHi 可視末尾ワード（含む）
 * @param cacheLo キャッシュ先頭
 * @param cacheHi キャッシュ末尾（含む）
 * @returns 再取得が必要なら true
 */
export function memNeedsRefetch(
  viewLo: number,
  viewHi: number,
  cacheLo: number,
  cacheHi: number,
): boolean {
  const nearLo = cacheLo > 0 && viewLo < cacheLo + MEM_REFETCH_MARGIN;
  const nearHi =
    cacheHi < PHYS_WORD_MASK && viewHi > cacheHi - MEM_REFETCH_MARGIN;
  return nearLo || nearHi;
}

/**
 * 端に近づいたときの次の取得中心。下端なら可視末尾、上端なら可視先頭を中心にする
 * （可視中央だと 0 始まりの窓が lo=0 のまま伸びず 0900h で止まる）。
 * @param viewLo 可視先頭ワード
 * @param viewHi 可視末尾ワード（含む）
 * @param cacheLo キャッシュ先頭
 * @param cacheHi キャッシュ末尾（含む）
 * @returns 次の中心。再取得不要なら null
 */
export function memNextCenter(
  viewLo: number,
  viewHi: number,
  cacheLo: number,
  cacheHi: number,
): number | null {
  const lo = viewLo & PHYS_WORD_MASK;
  const hi = viewHi & PHYS_WORD_MASK;
  if (!memNeedsRefetch(lo, hi, cacheLo, cacheHi)) {
    return null;
  }
  const nearLo = cacheLo > 0 && lo < cacheLo + MEM_REFETCH_MARGIN;
  const nearHi =
    cacheHi < PHYS_WORD_MASK && hi > cacheHi - MEM_REFETCH_MARGIN;
  if (nearHi && !nearLo) {
    return hi;
  }
  if (nearLo && !nearHi) {
    return lo;
  }
  return (Math.floor((lo + hi) / 2) >>> 0) & PHYS_WORD_MASK;
}

/**
 * ビッグエンディアンのバイト列をダンプ行にする。
 * @param lo 先頭物理ワード
 * @param bytes 偶数バイト列
 * @returns 16 ワード/行
 */
export function memDumpFromBeBytes(lo: number, bytes: Uint8Array): MemDumpRow[] {
  const words: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    words.push(((bytes[i]! << 8) | bytes[i + 1]!) & 0xffff);
  }
  while (words.length % MEM_WORDS_PER_ROW !== 0) {
    words.push(0);
  }
  const rows: MemDumpRow[] = [];
  for (let r = 0; r < words.length; r += MEM_WORDS_PER_ROW) {
    const addr = (lo + r) & PHYS_WORD_MASK;
    rows.push({
      addr: hex5(addr),
      words: words.slice(r, r + MEM_WORDS_PER_ROW).map(hex4),
    });
  }
  return rows;
}

/**
 * メモリダンプ行を読む。
 * @param startWord 先頭物理ワード
 * @param rows 行数
 * @param readWord ワード読み（18bit）
 * @returns ダンプ行
 */
export function makeMemDumpRows(
  startWord: number,
  rows: number,
  readWord: (wordAddr: number) => number,
): MemDumpRow[] {
  const out: MemDumpRow[] = [];
  let a = startWord & PHYS_WORD_MASK;
  for (let r = 0; r < rows; r += 1) {
    const words: string[] = [];
    for (let i = 0; i < MEM_WORDS_PER_ROW; i += 1) {
      words.push(hex4(readWord((a + i) & PHYS_WORD_MASK)));
    }
    out.push({ addr: hex5(a), words });
    a = (a + MEM_WORDS_PER_ROW) & PHYS_WORD_MASK;
  }
  return out;
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
    CSBR: "0",
    SSBR: "0",
    TSR0: "0",
    TSR1: "0",
    NPP: "00",
    IISR: "0",
    stack,
  };
}

/**
 * 画面シェル用の初期状態を返す。
 * @returns DebugViewState
 */
export function createMockDebugState(): DebugViewState {
  const current = makeRegs(0);
  const slotHistory: SlotBreakHist[] = [];
  for (let h = 0; h < 8; h += 1) {
    slotHistory.push({
      slot: 0,
      histIndex: h,
      kind: "MEM",
      access: "WRITE",
      condition: "=4000",
      value: hex4(0x8000 - h * 0x10),
      prevWrite: "4000",
      regs: makeRegs(h + 1),
    });
  }

  const emptySlot = (slot: number): BpSlotView => ({
    slot,
    kind: "INST",
    addr: "-----",
    access: "-",
    enabled: false,
    history: false,
  });

  const bpSlots: BpSlotView[] = [
    {
      slot: 0,
      kind: "INST",
      addr: "01800",
      access: "RD",
      enabled: true,
      history: false,
    },
    {
      slot: 1,
      kind: "MEM",
      addr: "00040",
      access: "WR",
      enabled: true,
      history: true,
    },
    {
      slot: 2,
      kind: "IO",
      addr: "00022",
      access: "R/W",
      enabled: false,
      history: false,
    },
    emptySlot(3),
    emptySlot(4),
    emptySlot(5),
    emptySlot(6),
    emptySlot(7),
  ];

  const memStart = DEFAULT_ENTRY_WORD;
  const win = memFetchRange(memStart);
  return {
    title: "MN1613 Debug",
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
    memDump: makeMemDumpRows(
      win.lo,
      Math.ceil(win.wordCount / MEM_WORDS_PER_ROW),
      () => 0,
    ),
    memStart,
    memCacheLo: win.lo,
    memCacheHi: win.hi,
    memNote: "IO 未接続 — retrocpu_emu を起動するとハンドシェイク 13h で読みます",
    bpSlots,
    current,
    slotHistory,
    viewMode: "current",
    histIndex: 0,
    pointSlot: 0,
  };
}
