/**
 * MN1613 逆アセンブラ試験
 * 根拠: MN1613.mdc / asm-rules.mdc / アセンブラ mn1613_instructions.test.ts
 */

import { describe, expect, it } from "vitest";
import { Mn1613Disassembler } from "../../src/dis_assembler/mn1613";

/**
 * 連続ワードを addr から読むリーダを作る。
 * @param words 命令語列
 * @param base 先頭ワードアドレス
 * @returns readWord
 */
function fromWords(
  words: number[],
  base = 0,
): (addr: number) => number {
  return (addr) => words[addr - base] ?? 0;
}

describe("Mn1613Disassembler 基本命令", () => {
  const d = new Mn1613Disassembler();

  it("H / RET / PSHM / POPM / RETL / BLK", () => {
    expect(d.disassemble(0, fromWords([0x2000]))).toEqual({
      text: "H",
      wordCount: 1,
      nextAddr: 1,
    });
    expect(d.disassemble(0, fromWords([0x2003])).text).toBe("RET");
    expect(d.disassemble(0, fromWords([0x170f])).text).toBe("PSHM");
    expect(d.disassemble(0, fromWords([0x1707])).text).toBe("POPM");
    expect(d.disassemble(0, fromWords([0x3f07])).text).toBe("RETL");
    expect(d.disassemble(0, fromWords([0x3f17])).text).toBe("BLK");
  });

  it("未定義 0x0000 は .word 1 語", () => {
    expect(d.disassemble(0x100, fromWords([0x0000], 0x100))).toEqual({
      text: ".word 0x0000",
      wordCount: 1,
      nextAddr: 0x101,
    });
  });

  it("MVI / MV / A / AI", () => {
    expect(d.disassemble(0, fromWords([0x0812])).text).toBe("MVI R0, #0x12");
    expect(d.disassemble(0, fromWords([0x7809])).text).toBe("MV R0, R1");
    expect(d.disassemble(0, fromWords([0x5809])).text).toBe("A R0, R1");
    expect(d.disassemble(0, fromWords([0x4804])).text).toBe("AI R0, #4");
  });

  it("L / ST ゼロページと B / BAL", () => {
    expect(d.disassemble(0, fromWords([0xc010])).text).toBe("L R0, *0x10");
    expect(d.disassemble(0, fromWords([0x8010])).text).toBe("ST R0, *0x10");
    expect(d.disassemble(0, fromWords([0xc710])).text).toBe("B *0x10");
    expect(d.disassemble(0, fromWords([0x8710])).text).toBe("BAL *0x10");
  });

  it("相対 L はターゲットアドレスを出す", () => {
    // L R0, rel: mmm=001, d=+2 → target = addr+1+2
    // encodeMem(1, 1, 0, 2) = 0xC000 | (1<<11) | 2 = 0xC802
    const r = d.disassemble(0x20, fromWords([0xc802], 0x20));
    expect(r.text).toBe("L R0, 0x0023");
    expect(r.wordCount).toBe(1);
    expect(r.nextAddr).toBe(0x21);
  });

  it("IMS / DMS / LPSW", () => {
    expect(d.disassemble(0, fromWords([0xc610])).text).toBe("IMS *0x10");
    expect(d.disassemble(0, fromWords([0x8610])).text).toBe("DMS *0x10");
    expect(d.disassemble(0, fromWords([0x2006])).text).toBe("LPSW 2");
  });

  it("PUSH / POP / SR / SL", () => {
    expect(d.disassemble(0, fromWords([0x2001])).text).toBe("PUSH R0");
    expect(d.disassemble(0, fromWords([0x2102])).text).toBe("POP R1");
    expect(d.disassemble(0, fromWords([0x2008])).text).toBe("SR R0");
    expect(d.disassemble(0, fromWords([0x200c])).text).toBe("SL R0");
    expect(d.disassemble(0, fromWords([0x2009])).text).toBe("SR R0, RE");
  });

  it("TBIT / SBIT / RBIT / NEG", () => {
    expect(d.disassemble(0, fromWords([0x2803])).text).toBe("TBIT R0, #3");
    expect(d.disassemble(0, fromWords([0x3803])).text).toBe("SBIT R0, #3");
    expect(d.disassemble(0, fromWords([0x3003])).text).toBe("RBIT R0, #3");
    expect(d.disassemble(0, fromWords([0x1f08])).text).toBe("NEG R0");
    expect(d.disassemble(0, fromWords([0x1f00])).text).toBe("NEG R0, C");
    expect(d.disassemble(0, fromWords([0x1f48])).text).toBe("NEG R0, Z");
  });

  it("skip 付き A", () => {
    // A R0, R1, Z: op=0x0B ddd=0 kkkk=4 sss=1 bit3=1 → 0x5849?
    // op5(0b01011, 0, 4, 0x09) = (0x0B<<11)|(0<<8)|(4<<4)|9 = 0x5800|0x40|9 = 0x5849
    expect(d.disassemble(0, fromWords([0x5849])).text).toBe("A R0, R1, Z");
  });
});

describe("Mn1613Disassembler 2語命令", () => {
  const d = new Mn1613Disassembler();

  it("MVWI / AWI / LD / STD / BD / BALD", () => {
    expect(d.disassemble(0, fromWords([0x7807, 0x1234]))).toEqual({
      text: "MVWI R0, #0x1234",
      wordCount: 2,
      nextAddr: 2,
    });
    expect(d.disassemble(0, fromWords([0x580f, 0x0010])).text).toBe(
      "AWI R0, #0x0010",
    );
    expect(d.disassemble(0, fromWords([0x2708, 0x0100])).text).toBe(
      "LD R0, 0x0100",
    );
    expect(d.disassemble(0, fromWords([0x2718, 0x0100])).text).toBe(
      "LD R0, 0x0100(SSBR)",
    );
    expect(d.disassemble(0, fromWords([0x2748, 0x0100])).text).toBe(
      "STD R0, 0x0100",
    );
    expect(d.disassemble(0, fromWords([0x2607, 0x1800])).text).toBe(
      "BD 0x1800",
    );
    expect(d.disassemble(0, fromWords([0x2617, 0x1800])).text).toBe(
      "BALD 0x1800",
    );
  });

  it("BL / BALL / TSET / TRST / LB", () => {
    expect(d.disassemble(0, fromWords([0x270f, 0x0200])).text).toBe(
      "BL @0x0200",
    );
    expect(d.disassemble(0, fromWords([0x271f, 0x0200])).text).toBe(
      "BALL @0x0200",
    );
    expect(d.disassemble(0, fromWords([0x1708, 0x0100])).text).toBe(
      "TSET R0, 0x0100",
    );
    expect(d.disassemble(0, fromWords([0x1748, 0x0100])).text).toBe(
      "TSET R0, 0x0100, Z",
    );
    expect(d.disassemble(0, fromWords([0x1700, 0x0200])).text).toBe(
      "TRST R0, 0x0200",
    );
    expect(d.disassemble(0, fromWords([0x0f17, 0x0100])).text).toBe(
      "LB SSBR, 0x0100",
    );
  });

  it("nextAddr はワードラップする", () => {
    const r = d.disassemble(0xffff, (a) => (a === 0xffff ? 0x2000 : 0));
    expect(r.wordCount).toBe(1);
    expect(r.nextAddr).toBe(0);
  });
});

describe("Mn1613Disassembler MN1613 間接・特殊", () => {
  const d = new Mn1613Disassembler();

  it("LR / STR / RDR / WTR / BR / BALR", () => {
    expect(d.disassemble(0, fromWords([0x2040])).text).toBe("LR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x20c0])).text).toBe("LR R0, (R1)+");
    expect(d.disassemble(0, fromWords([0x2080])).text).toBe("LR R0, -(R1)");
    expect(d.disassemble(0, fromWords([0x2050])).text).toBe(
      "LR R0, SSBR, (R1)",
    );
    expect(d.disassemble(0, fromWords([0x2044])).text).toBe("STR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x2014])).text).toBe("RDR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x2010])).text).toBe("WTR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x2704])).text).toBe("BR @(R1)");
    expect(d.disassemble(0, fromWords([0x2714])).text).toBe("BALR @(R1)");
  });

  it("MVWR / AWR / CPYB / SETB / SRBT / DEBP / RD", () => {
    expect(d.disassemble(0, fromWords([0x7f08])).text).toBe("MVWR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x5f08])).text).toBe("AWR R0, (R1)");
    expect(d.disassemble(0, fromWords([0x0f80])).text).toBe("CPYB R0, CSBR");
    expect(d.disassemble(0, fromWords([0x0f10])).text).toBe("SETB R0, SSBR");
    expect(d.disassemble(0, fromWords([0x3f70])).text).toBe("SRBT R0, R0");
    expect(d.disassemble(0, fromWords([0x3ff1])).text).toBe("DEBP R1, R0");
    expect(d.disassemble(0, fromWords([0x1824])).text).toBe("RD R0, 0x24");
    expect(d.disassemble(0, fromWords([0x1024])).text).toBe("WT R0, 0x24");
  });

  it("AD / M / FA / FIX", () => {
    expect(d.disassemble(0, fromWords([0x4f0c])).text).toBe("AD DR0, (R1)");
    expect(d.disassemble(0, fromWords([0x4f04])).text).toBe("AD DR0, (R1), C");
    expect(d.disassemble(0, fromWords([0x7f0c])).text).toBe("M DR0, (R1)");
    expect(d.disassemble(0, fromWords([0x6f0c])).text).toBe("FA DR0, (R1)");
    expect(d.disassemble(0, fromWords([0x1f04])).text).toBe("FIX R0, DR0");
  });
});

/** MN1613.mdc「命令一覧」の 97 種（未定義 .word は含まない） */
const ALL_MNEMONICS = [
  "L",
  "LD",
  "LR",
  "ST",
  "STD",
  "STR",
  "MV",
  "MVWR",
  "MVWI",
  "MVB",
  "MVBR",
  "BSWP",
  "BSWR",
  "DSWP",
  "DSWR",
  "PUSH",
  "PSHM",
  "POP",
  "POPM",
  "MVI",
  "A",
  "AWR",
  "AWI",
  "AI",
  "S",
  "SWR",
  "SWI",
  "SI",
  "C",
  "CWR",
  "CWI",
  "CB",
  "CBR",
  "CBI",
  "NEG",
  "AD",
  "SD",
  "M",
  "D",
  "DAA",
  "DAS",
  "LAD",
  "LADR",
  "LADI",
  "FA",
  "FS",
  "FM",
  "FD",
  "FIX",
  "FLT",
  "AND",
  "ANDR",
  "ANDI",
  "OR",
  "ORR",
  "ORI",
  "EOR",
  "EORR",
  "EORI",
  "IMS",
  "DMS",
  "B",
  "BD",
  "BL",
  "BR",
  "BAL",
  "BALD",
  "BALL",
  "BALR",
  "RET",
  "RETL",
  "LPSW",
  "TBIT",
  "SBIT",
  "RBIT",
  "TSET",
  "TRST",
  "SRBT",
  "DEBP",
  "SR",
  "SL",
  "BLK",
  "RD",
  "RDR",
  "WT",
  "WTR",
  "LB",
  "LS",
  "STB",
  "STS",
  "CPYB",
  "CPYS",
  "CPYH",
  "SETB",
  "SETS",
  "SETH",
  "H",
] as const;

/** 1 命令の期待（語列と逆アセンブル文字列） */
type InstCase = {
  words: number[];
  text: string;
};

/**
 * 命令語列から先頭ニーモニックを取る。
 * @param text 逆アセンブル文字列
 * @returns ニーモニック
 */
function mnemonicOf(text: string): string {
  return text.split(/\s+/, 1)[0]!;
}

describe("Mn1613Disassembler 全命令（97種）", () => {
  const d = new Mn1613Disassembler();

  /** 根拠: MN1613.mdc オペコード表 / アセンブラ mn1610/mn1613_instructions.test.ts */
  const cases: InstCase[] = [
    { words: [0xc010], text: "L R0, *0x10" },
    { words: [0x2708, 0x0100], text: "LD R0, 0x0100" },
    { words: [0x2040], text: "LR R0, (R1)" },
    { words: [0x8010], text: "ST R0, *0x10" },
    { words: [0x2748, 0x0100], text: "STD R0, 0x0100" },
    { words: [0x2044], text: "STR R0, (R1)" },
    { words: [0x7809], text: "MV R0, R1" },
    { words: [0x7f08], text: "MVWR R0, (R1)" },
    { words: [0x7807, 0x1234], text: "MVWI R0, #0x1234" },
    { words: [0x7801], text: "MVB R0, R1" },
    { words: [0x7f00], text: "MVBR R0, (R1)" },
    { words: [0x7009], text: "BSWP R0, R1" },
    { words: [0x7708], text: "BSWR R0, (R1)" },
    { words: [0x7001], text: "DSWP R0, R1" },
    { words: [0x7700], text: "DSWR R0, (R1)" },
    { words: [0x2001], text: "PUSH R0" },
    { words: [0x170f], text: "PSHM" },
    { words: [0x2102], text: "POP R1" },
    { words: [0x1707], text: "POPM" },
    { words: [0x0812], text: "MVI R0, #0x12" },
    { words: [0x5809], text: "A R0, R1" },
    { words: [0x5f08], text: "AWR R0, (R1)" },
    { words: [0x580f, 0x0010], text: "AWI R0, #0x0010" },
    { words: [0x4804], text: "AI R0, #4" },
    { words: [0x5801], text: "S R0, R1" },
    { words: [0x5f00], text: "SWR R0, (R1)" },
    { words: [0x5807, 0x0010], text: "SWI R0, #0x0010" },
    { words: [0x4005], text: "SI R0, #5" },
    { words: [0x5009], text: "C R0, R1" },
    { words: [0x5708], text: "CWR R0, (R1)" },
    { words: [0x500f, 0x00ff], text: "CWI R0, #0x00ff" },
    { words: [0x5001], text: "CB R0, R1" },
    { words: [0x5700], text: "CBR R0, (R1)" },
    { words: [0x5007, 0x00ff], text: "CBI R0, #0x00ff" },
    { words: [0x1f08], text: "NEG R0" },
    { words: [0x4f0c], text: "AD DR0, (R1)" },
    { words: [0x470c], text: "SD DR0, (R1)" },
    { words: [0x7f0c], text: "M DR0, (R1)" },
    { words: [0x770c], text: "D DR0, (R1)" },
    { words: [0x5f0c], text: "DAA R0, (R1)" },
    { words: [0x570c], text: "DAS R0, (R1)" },
    { words: [0x6801], text: "LAD R0, R1" },
    { words: [0x6f00], text: "LADR R0, (R1)" },
    { words: [0x6807, 0x1234], text: "LADI R0, #0x1234" },
    { words: [0x6f0c], text: "FA DR0, (R1)" },
    { words: [0x6f04], text: "FS DR0, (R1)" },
    { words: [0x670c], text: "FM DR0, (R1)" },
    { words: [0x6704], text: "FD DR0, (R1)" },
    { words: [0x1f04], text: "FIX R0, DR0" },
    { words: [0x1f0c], text: "FLT DR0, R0" },
    { words: [0x6809], text: "AND R0, R1" },
    { words: [0x6f08], text: "ANDR R0, (R1)" },
    { words: [0x680f, 0xf0f0], text: "ANDI R0, #0xf0f0" },
    { words: [0x6009], text: "OR R0, R1" },
    { words: [0x6708], text: "ORR R0, (R1)" },
    { words: [0x600f, 0x0f0f], text: "ORI R0, #0x0f0f" },
    { words: [0x6001], text: "EOR R0, R1" },
    { words: [0x6700], text: "EORR R0, (R1)" },
    { words: [0x6007, 0x5555], text: "EORI R0, #0x5555" },
    { words: [0xc610], text: "IMS *0x10" },
    { words: [0x8610], text: "DMS *0x10" },
    { words: [0xc710], text: "B *0x10" },
    { words: [0x2607, 0x1800], text: "BD 0x1800" },
    { words: [0x270f, 0x0200], text: "BL @0x0200" },
    { words: [0x2704], text: "BR @(R1)" },
    { words: [0x8710], text: "BAL *0x10" },
    { words: [0x2617, 0x1800], text: "BALD 0x1800" },
    { words: [0x271f, 0x0200], text: "BALL @0x0200" },
    { words: [0x2714], text: "BALR @(R1)" },
    { words: [0x2003], text: "RET" },
    { words: [0x3f07], text: "RETL" },
    { words: [0x2006], text: "LPSW 2" },
    { words: [0x2803], text: "TBIT R0, #3" },
    { words: [0x3803], text: "SBIT R0, #3" },
    { words: [0x3003], text: "RBIT R0, #3" },
    { words: [0x1708, 0x0100], text: "TSET R0, 0x0100" },
    { words: [0x1700, 0x0200], text: "TRST R0, 0x0200" },
    { words: [0x3f70], text: "SRBT R0, R0" },
    { words: [0x3ff1], text: "DEBP R1, R0" },
    { words: [0x2008], text: "SR R0" },
    { words: [0x200c], text: "SL R0" },
    { words: [0x3f17], text: "BLK" },
    { words: [0x1824], text: "RD R0, 0x24" },
    { words: [0x2014], text: "RDR R0, (R1)" },
    { words: [0x1024], text: "WT R0, 0x24" },
    { words: [0x2010], text: "WTR R0, (R1)" },
    { words: [0x0f17, 0x0100], text: "LB SSBR, 0x0100" },
    { words: [0x0f0f, 0x0100], text: "LS SBRB, 0x0100" },
    { words: [0x0f97, 0x0100], text: "STB SSBR, 0x0100" },
    { words: [0x0f8f, 0x0100], text: "STS SBRB, 0x0100" },
    { words: [0x0f80], text: "CPYB R0, CSBR" },
    { words: [0x0f88], text: "CPYS R0, SBRB" },
    { words: [0x3f80], text: "CPYH R0, TCR" },
    { words: [0x0f10], text: "SETB R0, SSBR" },
    { words: [0x0f08], text: "SETS R0, SBRB" },
    { words: [0x3f00], text: "SETH R0, TCR" },
    { words: [0x2000], text: "H" },
  ];

  it.each(cases)("$text", ({ words, text }) => {
    const r = d.disassemble(0, fromWords(words));
    expect(r.text).toBe(text);
    expect(r.wordCount).toBe(words.length);
    expect(r.nextAddr).toBe(words.length);
  });

  it("MN1613.mdc の 97 種をすべて含む", () => {
    expect(ALL_MNEMONICS).toHaveLength(97);
    expect(cases).toHaveLength(97);
    const got = new Set(cases.map((c) => mnemonicOf(c.text)));
    expect(got.size).toBe(97);
    for (const m of ALL_MNEMONICS) {
      expect(got.has(m), `missing ${m}`).toBe(true);
    }
  });
});

describe("Mn1613Disassembler ラベル", () => {
  it("初期化のラベル:アドレスペアで相対／直接が名前になる", () => {
    const d = new Mn1613Disassembler({
      labels: [
        { name: "LOOP", wordAddr: 0x0023 },
        { name: "ENTRY", wordAddr: 0x1800 },
        { name: "ZPBUF", wordAddr: 0x0010 },
      ],
    });
    expect(d.disassemble(0x20, fromWords([0xc802], 0x20)).text).toBe(
      "L R0, LOOP",
    );
    expect(d.disassemble(0, fromWords([0x2607, 0x1800])).text).toBe(
      "BD ENTRY",
    );
    expect(d.disassemble(0, fromWords([0xc010])).text).toBe("L R0, *ZPBUF");
    expect(d.disassemble(0, fromWords([0x7807, 0x1800])).text).toBe(
      "MVWI R0, #ENTRY",
    );
  });

  it("CDB テキストからラベルを読む（バイトアドレス）", () => {
    const d = new Mn1613Disassembler({
      cdbText: "L:G$gl_main$0$0:0210\nL:G$gl_bios_beep$0$0:0400\n",
    });
    // byte 0x0210 → word 0x0108
    expect(d.disassemble(0, fromWords([0x2617, 0x0108])).text).toBe(
      "BALD gl_main",
    );
    d.addLabel("BEEP", 0x0200);
    expect(d.disassemble(0, fromWords([0x2708, 0x0200])).text).toBe(
      "LD R0, BEEP",
    );
  });

  it("loadCdb / setLabels を後から呼べる", () => {
    const d = new Mn1613Disassembler();
    d.loadCdb("L:G$vec$0$0:0400\n");
    expect(d.disassemble(0, fromWords([0x270f, 0x0200])).text).toBe("BL @vec");
    d.setLabels([{ name: "IOCTRL", wordAddr: 0x22 }]);
    expect(d.disassemble(0, fromWords([0x1822])).text).toBe("RD R0, IOCTRL");
  });
});
