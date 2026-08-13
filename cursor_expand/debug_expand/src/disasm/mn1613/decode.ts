/**
 * MN1613 1 命令デコード（構造化オペランド）
 * 根拠: MN1613.mdc オペコード表 / mn1613.ts の実行デコード
 */

/** アドレス表示の形（ラベル解決は format 側） */
export type AddrForm =
  | "plain"
  | "zp"
  | "paren"
  | "at"
  | "star_paren"
  | "io"
  | "bb";

/** デコード済みオペランド */
export type DecodedOp =
  | { k: "raw"; s: string }
  | { k: "addr"; v: number; form: AddrForm; bb?: string }
  | { k: "imm"; v: number; bits: 4 | 8 | 16 }
  | { k: "skip"; n: number }
  | { k: "ee"; n: number }
  | { k: "c" };

/** 1 命令のデコード結果 */
export type DecodedInst = {
  mnemonic: string;
  ops: DecodedOp[];
  wordCount: 1 | 2;
  ir: number;
};

const REGS = ["R0", "R1", "R2", "R3", "R4", "SP", "STR", "IC"] as const;
const RI = ["R1", "R2", "R3", "R4"] as const;
const BB = ["CSBR", "SSBR", "TSR0", "TSR1"] as const;
const BBB = ["CSBR", "SSBR", "TSR0", "TSR1", "OSR0", "OSR1", "OSR2", "OSR3"] as const;
const PPP = ["SBRB", "ICB", "NPP"] as const;
const HHH = ["TCR", "TIR", "TSR", "SCR", "SSR", "SOR", "IISR"] as const;

/**
 * 汎用レジスタ名。
 * @param rrr 0–7
 * @returns R0–R4 / SP / STR / IC
 */
export function regName(rrr: number): string {
  return REGS[rrr & 7]!;
}

/**
 * 間接レジスタ名（ii）。
 * @param ii 0–3
 * @returns R1–R4
 */
export function riName(ii: number): string {
  return RI[ii & 3]!;
}

/**
 * 符号付き 8bit 相対のターゲット（フェッチ後 IC = 命令アドレス+1）。
 * @param instrAddr 命令先頭ワードアドレス
 * @param d 符号なし 8bit ディスプレースメント
 * @returns ターゲットワードアドレス
 */
export function relTarget(instrAddr: number, d: number): number {
  const sd = d < 0x80 ? d : d - 0x100;
  return (instrAddr + 1 + sd) & 0xffff;
}

/**
 * 未定義命令として `.word` にする。
 * @param ir 命令語
 * @returns デコード結果（1 語）
 */
function undef(ir: number): DecodedInst {
  return {
    mnemonic: ".word",
    ops: [{ k: "imm", v: ir & 0xffff, bits: 16 }],
    wordCount: 1,
    ir,
  };
}

/**
 * mm 付きレジスタ間接の文字列。
 * @param mm 01=(Ri) 10=-(Ri) 11=(Ri)+
 * @param ii 間接レジスタ
 * @returns 書式文字列。mm=00 なら null
 */
function riMode(mm: number, ii: number): string | null {
  const r = riName(ii);
  if (mm === 1) return `(${r})`;
  if (mm === 2) return `-(${r})`;
  if (mm === 3) return `(${r})+`;
  return null;
}

/**
 * skip / EE / C を末尾に足す。
 * @param ops 既存オペランド
 * @param skip kkkk（0 なら省略）
 * @param ee EE（省略可）
 * @param carry true なら `, C`
 */
function trail(
  ops: DecodedOp[],
  skip: number,
  ee?: number,
  carry?: boolean,
): DecodedOp[] {
  const out = [...ops];
  if (carry) out.push({ k: "c" });
  if (ee !== undefined && (ee & 3) !== 0) out.push({ k: "ee", n: ee & 3 });
  if ((skip & 0xf) !== 0) out.push({ k: "skip", n: skip & 0xf });
  return out;
}

/**
 * 1 語命令。
 * @param mnemonic ニーモニック
 * @param ir 命令語
 * @param ops オペランド
 */
function one(mnemonic: string, ir: number, ops: DecodedOp[] = []): DecodedInst {
  return { mnemonic, ops, wordCount: 1, ir };
}

/**
 * 2 語命令。
 * @param mnemonic ニーモニック
 * @param ir 第1語
 * @param extra 第2語
 * @param ops オペランド
 */
function two(
  mnemonic: string,
  ir: number,
  _extra: number,
  ops: DecodedOp[],
): DecodedInst {
  return { mnemonic, ops, wordCount: 2, ir };
}

/**
 * MN1610 互換 EA（L/ST/B/BAL/IMS/DMS）。
 * @param mmm モード
 * @param d 8bit
 * @param instrAddr 命令アドレス
 * @returns オペランド 1 つ
 */
function eaOp(mmm: number, d: number, instrAddr: number): DecodedOp {
  const disp = d & 0xff;
  switch (mmm & 7) {
    case 0:
      return { k: "addr", v: disp, form: "zp" };
    case 1:
      return { k: "addr", v: relTarget(instrAddr, disp), form: "plain" };
    case 2:
      return { k: "addr", v: disp, form: "star_paren" };
    case 3:
      return { k: "addr", v: relTarget(instrAddr, disp), form: "paren" };
    case 4:
      return { k: "raw", s: `${hex8(disp)}(X0)` };
    case 5:
      return { k: "raw", s: `${hex8(disp)}(X1)` };
    case 6:
      return { k: "raw", s: `(*${hex8(disp)})(X0)` };
    default:
      return { k: "raw", s: `(*${hex8(disp)})(X1)` };
  }
}

/**
 * 8bit を `0xHH` にする（インデックス変位用）。
 * @param v 0–255
 * @returns 16進文字列
 */
function hex8(v: number): string {
  return `0x${(v & 0xff).toString(16).padStart(2, "0")}`;
}

/**
 * 指定ワードアドレスの 1 命令をデコードする。
 * @param addr ワードアドレス
 * @param readWord メモリ読み（16bit）
 * @returns 構造化命令。未定義は `.word`
 */
export function decodeMn1613(
  addr: number,
  readWord: (wordAddr: number) => number,
): DecodedInst {
  const a = addr & 0xffff;
  const ir = readWord(a) & 0xffff;
  /** 2語目を読む */
  const extra = () => readWord((a + 1) & 0xffff) & 0xffff;
  const op = (ir >>> 11) & 0x1f;
  const rrr = (ir >>> 8) & 7;
  const lo = ir & 0xff;
  const kkkk = (lo >>> 4) & 0xf;
  const b32 = (lo >>> 2) & 3;
  const b10 = lo & 3;

  if (op >= 0x10) {
    const mmm = op & 7;
    const isHi = (op & 8) !== 0;
    const ea = eaOp(mmm, lo, a);
    if (rrr === 7) {
      return one(isHi ? "B" : "BAL", ir, [ea]);
    }
    if (rrr === 6) {
      return one(isHi ? "IMS" : "DMS", ir, [ea]);
    }
    return one(isHi ? "L" : "ST", ir, [{ k: "raw", s: regName(rrr) }, ea]);
  }

  switch (op) {
    case 0x00:
      return undef(ir);

    case 0x01:
      return decode01(ir, rrr, lo, extra);

    case 0x02:
      return decode02(ir, rrr, lo, kkkk, extra);

    case 0x03:
      return decode03(ir, rrr, lo, kkkk);

    case 0x04:
      return decode04(ir, rrr, lo, kkkk, b32, extra);

    case 0x05:
      return one(
        "TBIT",
        ir,
        trail(
          [
            { k: "raw", s: regName(rrr) },
            { k: "imm", v: lo & 0xf, bits: 4 },
          ],
          kkkk,
        ),
      );

    case 0x06:
      return one(
        "RBIT",
        ir,
        trail(
          [
            { k: "raw", s: regName(rrr) },
            { k: "imm", v: lo & 0xf, bits: 4 },
          ],
          kkkk,
        ),
      );

    case 0x07:
      return decode07(ir, rrr, lo, kkkk);

    case 0x08:
      return decode08(ir, rrr, lo, kkkk, b10);

    case 0x09:
      return decode09(ir, rrr, lo, kkkk, b10);

    case 0x0a:
      return decode0a(ir, rrr, lo, kkkk, extra);

    case 0x0b:
      return decode0b(ir, rrr, lo, kkkk, extra);

    case 0x0c:
      return decode0c(ir, rrr, lo, kkkk, extra);

    case 0x0d:
      return decode0d(ir, rrr, lo, kkkk, extra);

    case 0x0e:
      return decode0e(ir, rrr, lo, kkkk);

    case 0x0f:
      return decode0f(ir, rrr, lo, kkkk, extra);

    default:
      return undef(ir);
  }
}

/**
 * op=0x01: MVI / LB / LS / STB / STS / CPYB / CPYS / SETB / SETS
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param extra 第2語読み
 */
function decode01(
  ir: number,
  rrr: number,
  lo: number,
  extra: () => number,
): DecodedInst {
  if (rrr !== 7) {
    return one("MVI", ir, [
      { k: "raw", s: regName(rrr) },
      { k: "imm", v: lo, bits: 8 },
    ]);
  }
  const bit7 = (lo >>> 7) & 1;
  const bBits = (lo >>> 4) & 7;
  const bit3 = (lo >>> 3) & 1;
  const bLo = lo & 7;
  if (bLo === 7) {
    const ad = extra();
    const addr: DecodedOp = { k: "addr", v: ad, form: "plain" };
    if (bit7 === 0 && bit3 === 0) {
      return two("LB", ir, ad, [{ k: "raw", s: BBB[bBits]! }, addr]);
    }
    if (bit7 === 0 && bit3 === 1) {
      const sr = PPP[bBits];
      if (!sr) return undef(ir);
      return two("LS", ir, ad, [{ k: "raw", s: sr }, addr]);
    }
    if (bit7 === 1 && bit3 === 0) {
      return two("STB", ir, ad, [{ k: "raw", s: BBB[bBits]! }, addr]);
    }
    const sr = PPP[bBits];
    if (!sr) return undef(ir);
    return two("STS", ir, ad, [{ k: "raw", s: sr }, addr]);
  }
  if (bit7 === 1 && bit3 === 0) {
    return one("CPYB", ir, [
      { k: "raw", s: regName(bLo) },
      { k: "raw", s: BBB[bBits]! },
    ]);
  }
  if (bit7 === 1 && bit3 === 1) {
    const sr = PPP[bBits];
    if (!sr) return undef(ir);
    return one("CPYS", ir, [
      { k: "raw", s: regName(bLo) },
      { k: "raw", s: sr },
    ]);
  }
  if (bit7 === 0 && bit3 === 0) {
    return one("SETB", ir, [
      { k: "raw", s: regName(bLo) },
      { k: "raw", s: BBB[bBits]! },
    ]);
  }
  const sr = PPP[bBits];
  if (!sr) return undef(ir);
  return one("SETS", ir, [
    { k: "raw", s: regName(bLo) },
    { k: "raw", s: sr },
  ]);
}

/**
 * op=0x02: WT / PSHM / POPM / TSET / TRST
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 * @param extra 第2語
 */
function decode02(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  if (rrr !== 7) {
    return one("WT", ir, [
      { k: "raw", s: regName(rrr) },
      { k: "addr", v: lo, form: "io" },
    ]);
  }
  if (lo === 0x0f) return one("PSHM", ir);
  if (lo === 0x07) return one("POPM", ir);
  const ad = extra();
  const sss = lo & 7;
  const mnem = (lo & 8) !== 0 ? "TSET" : "TRST";
  return two(
    mnem,
    ir,
    ad,
    trail(
      [
        { k: "raw", s: regName(sss) },
        { k: "addr", v: ad, form: "plain" },
      ],
      kkkk,
    ),
  );
}

/**
 * op=0x03: RD / NEG / FIX / FLT
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 */
function decode03(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
): DecodedInst {
  if (rrr !== 7) {
    return one("RD", ir, [
      { k: "raw", s: regName(rrr) },
      { k: "addr", v: lo, form: "io" },
    ]);
  }
  const bit3 = (lo >>> 3) & 1;
  const bit2 = (lo >>> 2) & 1;
  if (bit2 === 1) {
    if (bit3 === 0) {
      return one("FIX", ir, trail([{ k: "raw", s: "R0" }, { k: "raw", s: "DR0" }], kkkk));
    }
    return one("FLT", ir, trail([{ k: "raw", s: "DR0" }, { k: "raw", s: "R0" }], kkkk));
  }
  const ddd = lo & 7;
  return one(
    "NEG",
    ir,
    trail([{ k: "raw", s: regName(ddd) }], kkkk, undefined, bit3 === 0),
  );
}

/**
 * op=0x04: H / RET / LPSW / BD / BALD / BR / BALR / LD / STD / BL / BALL /
 * PUSH / POP / LR / STR / SR / SL / RDR / WTR
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip（SR/SL）
 * @param b32 bits[3:2]
 * @param extra 第2語
 */
function decode04(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  b32: number,
  extra: () => number,
): DecodedInst {
  const b76 = (lo >>> 6) & 3;
  const b54 = (lo >>> 4) & 3;
  const b10 = lo & 3;
  const ee = b10;

  if (rrr === 0) {
    if (lo === 0x00) return one("H", ir);
    if (lo === 0x03) return one("RET", ir);
    if (lo >= 0x04 && lo <= 0x07) {
      return one("LPSW", ir, [{ k: "raw", s: String(lo & 3) }]);
    }
  }

  if (rrr === 6) {
    if (lo === 0x07) {
      const ad = extra();
      return two("BD", ir, ad, [{ k: "addr", v: ad, form: "plain" }]);
    }
    if (lo === 0x17) {
      const ad = extra();
      return two("BALD", ir, ad, [{ k: "addr", v: ad, form: "plain" }]);
    }
  }

  if (rrr === 7) {
    if ((lo & 0xfc) === 0x04) {
      return one("BR", ir, [{ k: "raw", s: `@(${riName(b10)})` }]);
    }
    if ((lo & 0xfc) === 0x14) {
      return one("BALR", ir, [{ k: "raw", s: `@(${riName(b10)})` }]);
    }
    if ((lo & 0x08) !== 0) {
      const dest = lo & 7;
      const ad = extra();
      if ((lo & 0x40) === 0) {
        if (dest === 7) {
          const mnem = b54 === 1 ? "BALL" : "BL";
          return two(mnem, ir, ad, [{ k: "addr", v: ad, form: "at" }]);
        }
        const ops: DecodedOp[] = [{ k: "raw", s: regName(dest) }];
        if (b54 === 0) {
          ops.push({ k: "addr", v: ad, form: "plain" });
        } else {
          ops.push({ k: "addr", v: ad, form: "bb", bb: BB[b54]! });
        }
        return two("LD", ir, ad, ops);
      }
      const ops: DecodedOp[] = [{ k: "raw", s: regName(dest) }];
      if (b54 === 0) {
        ops.push({ k: "addr", v: ad, form: "plain" });
      } else {
        ops.push({ k: "addr", v: ad, form: "bb", bb: BB[b54]! });
      }
      return two("STD", ir, ad, ops);
    }
  }

  if (lo === 0x01) {
    return one("PUSH", ir, [{ k: "raw", s: regName(rrr) }]);
  }
  if (lo === 0x02) {
    return one("POP", ir, [{ k: "raw", s: regName(rrr) }]);
  }

  const mmStr = riMode(b76, b10);
  if (b32 === 0 && mmStr) {
    const ops: DecodedOp[] = [{ k: "raw", s: regName(rrr) }];
    if (b54 !== 0) ops.push({ k: "raw", s: BB[b54]! });
    ops.push({ k: "raw", s: mmStr });
    return one("LR", ir, ops);
  }
  if (b32 === 1 && mmStr) {
    const ops: DecodedOp[] = [{ k: "raw", s: regName(rrr) }];
    if (b54 !== 0) ops.push({ k: "raw", s: BB[b54]! });
    ops.push({ k: "raw", s: mmStr });
    return one("STR", ir, ops);
  }

  if (b32 === 2) {
    return one(
      "SR",
      ir,
      trail([{ k: "raw", s: regName(rrr) }], kkkk, ee),
    );
  }
  if (b32 === 3) {
    return one(
      "SL",
      ir,
      trail([{ k: "raw", s: regName(rrr) }], kkkk, ee),
    );
  }

  if (lo >>> 4 === 1 && b32 === 1 && rrr !== 7) {
    return one("RDR", ir, [
      { k: "raw", s: regName(rrr) },
      { k: "raw", s: `(${riName(b10)})` },
    ]);
  }
  if (lo >>> 4 === 1 && b32 === 0) {
    return one("WTR", ir, [
      { k: "raw", s: regName(rrr) },
      { k: "raw", s: `(${riName(b10)})` },
    ]);
  }

  return undef(ir);
}

/**
 * op=0x07: SBIT / RETL / BLK / SRBT / DEBP / SETH / CPYH
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 */
function decode07(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
): DecodedInst {
  if (rrr !== 7) {
    return one(
      "SBIT",
      ir,
      trail(
        [
          { k: "raw", s: regName(rrr) },
          { k: "imm", v: lo & 0xf, bits: 4 },
        ],
        kkkk,
      ),
    );
  }
  if (lo === 0x07) return one("RETL", ir);
  if (lo === 0x17) return one("BLK", ir);
  if (lo >>> 4 === 0x7 && (lo & 8) === 0) {
    return one("SRBT", ir, [
      { k: "raw", s: "R0" },
      { k: "raw", s: regName(lo & 7) },
    ]);
  }
  if (lo >>> 4 === 0xf && (lo & 8) === 0) {
    return one("DEBP", ir, [
      { k: "raw", s: regName(lo & 7) },
      { k: "raw", s: "R0" },
    ]);
  }
  if ((lo & 8) !== 0) return undef(ir);
  const bit7 = (lo >>> 7) & 1;
  const hhh = (lo >>> 4) & 7;
  const hr = HHH[hhh];
  if (!hr) return undef(ir);
  const rd = regName(lo & 7);
  if (bit7 === 1) {
    return one("CPYH", ir, [
      { k: "raw", s: rd },
      { k: "raw", s: hr },
    ]);
  }
  return one("SETH", ir, [
    { k: "raw", s: rd },
    { k: "raw", s: hr },
  ]);
}

/**
 * op=0x08: SI / SD
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 * @param b10 ii
 */
function decode08(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  b10: number,
): DecodedInst {
  if (rrr === 7 && (lo & 4) !== 0) {
    const c = (lo >>> 3) & 1;
    return one(
      "SD",
      ir,
      trail(
        [{ k: "raw", s: "DR0" }, { k: "raw", s: `(${riName(b10)})` }],
        kkkk,
        undefined,
        c === 0,
      ),
    );
  }
  return one(
    "SI",
    ir,
    trail(
      [
        { k: "raw", s: regName(rrr) },
        { k: "imm", v: lo & 0xf, bits: 4 },
      ],
      kkkk,
    ),
  );
}

/**
 * op=0x09: AI / AD
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 * @param b10 ii
 */
function decode09(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  b10: number,
): DecodedInst {
  if (rrr === 7 && (lo & 4) !== 0) {
    const c = (lo >>> 3) & 1;
    return one(
      "AD",
      ir,
      trail(
        [{ k: "raw", s: "DR0" }, { k: "raw", s: `(${riName(b10)})` }],
        kkkk,
        undefined,
        c === 0,
      ),
    );
  }
  return one(
    "AI",
    ir,
    trail(
      [
        { k: "raw", s: regName(rrr) },
        { k: "imm", v: lo & 0xf, bits: 4 },
      ],
      kkkk,
    ),
  );
}

/**
 * レジスタ間 / 即値 / 間接の 5bit オペコード族（0x0A–0x0F）共通。
 * @param ir 命令語
 * @param rrr RRR
 * @param lo 下位 8bit
 * @param kkkk skip
 * @param extra 第2語
 * @param spec rrr=7 のとき b32 別ニーモニック、rrr≠7 のとき bit3 別
 */
function decodeRegFamily(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
  spec: {
    when7: [string, string, string, string];
    immHi: string;
    immLo: string;
    bit1: string;
    bit0: string;
    acc7?: "R0" | "DR0";
  },
): DecodedInst {
  const b32 = (lo >>> 2) & 3;
  const b10 = lo & 3;
  const tail = lo & 0xf;
  if (rrr === 7) {
    const mnem = spec.when7[b32]!;
    if (!mnem) return undef(ir);
    const acc = spec.acc7 ?? "R0";
    return one(
      mnem,
      ir,
      trail([{ k: "raw", s: acc }, { k: "raw", s: `(${riName(b10)})` }], kkkk),
    );
  }
  if (tail === 0x0f) {
    const im = extra();
    return two(
      spec.immHi,
      ir,
      im,
      trail(
        [
          { k: "raw", s: regName(rrr) },
          { k: "imm", v: im, bits: 16 },
        ],
        kkkk,
      ),
    );
  }
  if (tail === 0x07) {
    const im = extra();
    return two(
      spec.immLo,
      ir,
      im,
      trail(
        [
          { k: "raw", s: regName(rrr) },
          { k: "imm", v: im, bits: 16 },
        ],
        kkkk,
      ),
    );
  }
  const sss = lo & 7;
  const mnem = (lo & 8) !== 0 ? spec.bit1 : spec.bit0;
  return one(
    mnem,
    ir,
    trail(
      [
        { k: "raw", s: regName(rrr) },
        { k: "raw", s: regName(sss) },
      ],
      kkkk,
    ),
  );
}

/**
 * op=0x0A: C / CB / CWR / CWI / CBR / CBI / DAS
 */
function decode0a(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  if (rrr === 7 && (lo & 4) !== 0) {
    const c = (lo >>> 3) & 1;
    return one(
      "DAS",
      ir,
      trail(
        [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
        kkkk,
        undefined,
        c === 0,
      ),
    );
  }
  return decodeRegFamily(ir, rrr, lo, kkkk, extra, {
    when7: ["CBR", "", "CWR", ""],
    immHi: "CWI",
    immLo: "CBI",
    bit1: "C",
    bit0: "CB",
  });
}

/**
 * op=0x0B: A / S / AWR / SWR / AWI / SWI / DAA
 */
function decode0b(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  if (rrr === 7 && (lo & 4) !== 0) {
    const c = (lo >>> 3) & 1;
    return one(
      "DAA",
      ir,
      trail(
        [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
        kkkk,
        undefined,
        c === 0,
      ),
    );
  }
  return decodeRegFamily(ir, rrr, lo, kkkk, extra, {
    when7: ["SWR", "", "AWR", ""],
    immHi: "AWI",
    immLo: "SWI",
    bit1: "A",
    bit0: "S",
  });
}

/**
 * op=0x0C: OR / EOR / ORR / EORR / ORI / EORI / FM / FD
 */
function decode0c(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  const b32 = (lo >>> 2) & 3;
  return decodeRegFamily(ir, rrr, lo, kkkk, extra, {
    when7: ["EORR", "FD", "ORR", "FM"],
    immHi: "ORI",
    immLo: "EORI",
    bit1: "OR",
    bit0: "EOR",
    acc7: b32 === 1 || b32 === 3 ? "DR0" : "R0",
  });
}

/**
 * op=0x0D: AND / LAD / ANDR / LADR / ANDI / LADI / FA / FS
 */
function decode0d(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  const b32 = (lo >>> 2) & 3;
  return decodeRegFamily(ir, rrr, lo, kkkk, extra, {
    when7: ["LADR", "FS", "ANDR", "FA"],
    immHi: "ANDI",
    immLo: "LADI",
    bit1: "AND",
    bit0: "LAD",
    acc7: b32 === 1 || b32 === 3 ? "DR0" : "R0",
  });
}

/**
 * op=0x0E: BSWP / DSWP / BSWR / DSWR / D
 */
function decode0e(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
): DecodedInst {
  const b32 = (lo >>> 2) & 3;
  if (rrr === 7) {
    if (b32 === 3) {
      return one(
        "D",
        ir,
        trail(
          [{ k: "raw", s: "DR0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    if (b32 === 2) {
      return one(
        "BSWR",
        ir,
        trail(
          [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    if (b32 === 0) {
      return one(
        "DSWR",
        ir,
        trail(
          [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    return undef(ir);
  }
  const sss = lo & 7;
  if ((lo & 0xf) === 0x07 || (lo & 0xf) === 0x0f) return undef(ir);
  const mnem = (lo & 8) !== 0 ? "BSWP" : "DSWP";
  return one(
    mnem,
    ir,
    trail(
      [
        { k: "raw", s: regName(rrr) },
        { k: "raw", s: regName(sss) },
      ],
      kkkk,
    ),
  );
}

/**
 * op=0x0F: MV / MVB / MVWR / MVBR / MVWI / M
 */
function decode0f(
  ir: number,
  rrr: number,
  lo: number,
  kkkk: number,
  extra: () => number,
): DecodedInst {
  const b32 = (lo >>> 2) & 3;
  const tail = lo & 0xf;
  if (rrr !== 7 && tail === 0x07) {
    const im = extra();
    return two(
      "MVWI",
      ir,
      im,
      trail(
        [
          { k: "raw", s: regName(rrr) },
          { k: "imm", v: im, bits: 16 },
        ],
        kkkk,
      ),
    );
  }
  if (rrr === 7) {
    if (b32 === 3) {
      return one(
        "M",
        ir,
        trail(
          [{ k: "raw", s: "DR0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    if (b32 === 2) {
      return one(
        "MVWR",
        ir,
        trail(
          [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    if (b32 === 0) {
      return one(
        "MVBR",
        ir,
        trail(
          [{ k: "raw", s: "R0" }, { k: "raw", s: `(${riName(lo & 3)})` }],
          kkkk,
        ),
      );
    }
    return undef(ir);
  }
  const sss = lo & 7;
  const mnem = (lo & 8) !== 0 ? "MV" : "MVB";
  return one(
    mnem,
    ir,
    trail(
      [
        { k: "raw", s: regName(rrr) },
        { k: "raw", s: regName(sss) },
      ],
      kkkk,
    ),
  );
}
