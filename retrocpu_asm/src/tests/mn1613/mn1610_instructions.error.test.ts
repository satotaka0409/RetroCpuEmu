/**
 * MN1610 モードで MN1613 専用命令を使用したときのエラーテスト
 *
 * --cpu mn1610 指定時（= assemble(src, "mn1610")）に MN1613 専用命令を
 * アセンブルしようとするとエラーがスローされることを検証する。
 *
 * 実行方法:
 *   node --require tsx/cjs --test src/tests/mn1613/mn1610_instructions.error.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../../main/assembler";

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

/**
 * 1命令ソース（.org 0 付き）を MN1610 モードでアセンブルする。
 * MN1613 専用命令であれば Error がスローされることを期待する。
 */
function mn1610Err(src: string): () => void {
  return () => assemble(`        .org 0\n${src}\n`, "mn1610");
}

/** エラーメッセージが "MN1613 専用命令" を含むことを確認する共通 matcher */
const MN1613_ONLY_RE = /MN1613 専用命令/;

// ─── データ転送命令 ───────────────────────────────────────────────────────────

describe("MN1610 モード: データ転送命令はエラー", () => {
  test("LD R0, 0x0100", () => {
    assert.throws(mn1610Err("        LD R0, 0x0100"), MN1613_ONLY_RE);
  });
  test("STD R0, 0x0100", () => {
    assert.throws(mn1610Err("        STD R0, 0x0100"), MN1613_ONLY_RE);
  });
  test("LR R0, (R1)", () => {
    assert.throws(mn1610Err("        LR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("STR R0, (R1)", () => {
    assert.throws(mn1610Err("        STR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("MVWR R0, (R1)", () => {
    assert.throws(mn1610Err("        MVWR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("MVWI R0, 0x1234", () => {
    assert.throws(mn1610Err("        MVWI R0, 0x1234"), MN1613_ONLY_RE);
  });
  test("MVBR R0, (R1)", () => {
    assert.throws(mn1610Err("        MVBR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("BSWR R0, (R1)", () => {
    assert.throws(mn1610Err("        BSWR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("DSWR R0, (R1)", () => {
    assert.throws(mn1610Err("        DSWR R0, (R1)"), MN1613_ONLY_RE);
  });
});

// ─── スタック命令 ─────────────────────────────────────────────────────────────

describe("MN1610 モード: スタック命令はエラー", () => {
  test("PSHM", () => {
    assert.throws(mn1610Err("        PSHM"), MN1613_ONLY_RE);
  });
  test("POPM", () => {
    assert.throws(mn1610Err("        POPM"), MN1613_ONLY_RE);
  });
});

// ─── 整数演算命令 ─────────────────────────────────────────────────────────────

describe("MN1610 モード: 整数演算命令はエラー", () => {
  test("AWR R0, (R1)", () => {
    assert.throws(mn1610Err("        AWR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("AWI R0, 0x0001", () => {
    assert.throws(mn1610Err("        AWI R0, 0x0001"), MN1613_ONLY_RE);
  });
  test("SWR R0, (R1)", () => {
    assert.throws(mn1610Err("        SWR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("SWI R0, 0x0001", () => {
    assert.throws(mn1610Err("        SWI R0, 0x0001"), MN1613_ONLY_RE);
  });
  test("CWR R0, (R1)", () => {
    assert.throws(mn1610Err("        CWR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("CWI R0, 0x0001", () => {
    assert.throws(mn1610Err("        CWI R0, 0x0001"), MN1613_ONLY_RE);
  });
  test("CBR R0, (R1)", () => {
    assert.throws(mn1610Err("        CBR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("CBI R0, 0x0001", () => {
    assert.throws(mn1610Err("        CBI R0, 0x0001"), MN1613_ONLY_RE);
  });
  test("NEG R0", () => {
    assert.throws(mn1610Err("        NEG R0"), MN1613_ONLY_RE);
  });
  test("AD DR0, (R1)", () => {
    assert.throws(mn1610Err("        AD DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("SD DR0, (R1)", () => {
    assert.throws(mn1610Err("        SD DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("M DR0, (R1)", () => {
    assert.throws(mn1610Err("        M DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("D DR0, (R1)", () => {
    assert.throws(mn1610Err("        D DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("DAA R0, (R1)", () => {
    assert.throws(mn1610Err("        DAA R0, (R1)"), MN1613_ONLY_RE);
  });
  test("DAS R0, (R1)", () => {
    assert.throws(mn1610Err("        DAS R0, (R1)"), MN1613_ONLY_RE);
  });
  test("LADR R0, (R1)", () => {
    assert.throws(mn1610Err("        LADR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("LADI R0, 0x0001", () => {
    assert.throws(mn1610Err("        LADI R0, 0x0001"), MN1613_ONLY_RE);
  });
});

// ─── 論理演算命令 ─────────────────────────────────────────────────────────────

describe("MN1610 モード: 論理演算命令はエラー", () => {
  test("ANDR R0, (R1)", () => {
    assert.throws(mn1610Err("        ANDR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("ANDI R0, 0x00FF", () => {
    assert.throws(mn1610Err("        ANDI R0, 0x00FF"), MN1613_ONLY_RE);
  });
  test("ORR R0, (R1)", () => {
    assert.throws(mn1610Err("        ORR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("ORI R0, 0x00FF", () => {
    assert.throws(mn1610Err("        ORI R0, 0x00FF"), MN1613_ONLY_RE);
  });
  test("EORR R0, (R1)", () => {
    assert.throws(mn1610Err("        EORR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("EORI R0, 0x00FF", () => {
    assert.throws(mn1610Err("        EORI R0, 0x00FF"), MN1613_ONLY_RE);
  });
});

// ─── 浮動小数点演算命令 ───────────────────────────────────────────────────────

describe("MN1610 モード: 浮動小数点演算命令はエラー", () => {
  test("FA DR0, (R1)", () => {
    assert.throws(mn1610Err("        FA DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("FS DR0, (R1)", () => {
    assert.throws(mn1610Err("        FS DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("FM DR0, (R1)", () => {
    assert.throws(mn1610Err("        FM DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("FD DR0, (R1)", () => {
    assert.throws(mn1610Err("        FD DR0, (R1)"), MN1613_ONLY_RE);
  });
  test("FIX R0, DR0", () => {
    assert.throws(mn1610Err("        FIX R0, DR0"), MN1613_ONLY_RE);
  });
  test("FLT DR0, R0", () => {
    assert.throws(mn1610Err("        FLT DR0, R0"), MN1613_ONLY_RE);
  });
});

// ─── 分岐命令 ─────────────────────────────────────────────────────────────────

describe("MN1610 モード: 分岐命令はエラー", () => {
  test("BD 0x0010", () => {
    assert.throws(mn1610Err("        BD 0x0010"), MN1613_ONLY_RE);
  });
  test("BL 0x0010", () => {
    assert.throws(mn1610Err("        BL 0x0010"), MN1613_ONLY_RE);
  });
  test("BR (R1)", () => {
    assert.throws(mn1610Err("        BR (R1)"), MN1613_ONLY_RE);
  });
  test("BALD 0x0010", () => {
    assert.throws(mn1610Err("        BALD 0x0010"), MN1613_ONLY_RE);
  });
  test("BALL 0x0010", () => {
    assert.throws(mn1610Err("        BALL 0x0010"), MN1613_ONLY_RE);
  });
  test("BALR (R1)", () => {
    assert.throws(mn1610Err("        BALR (R1)"), MN1613_ONLY_RE);
  });
  test("RETL", () => {
    assert.throws(mn1610Err("        RETL"), MN1613_ONLY_RE);
  });
});

// ─── ビット操作命令 ───────────────────────────────────────────────────────────

describe("MN1610 モード: ビット操作命令はエラー", () => {
  test("TSET R0, 0x0010", () => {
    assert.throws(mn1610Err("        TSET R0, 0x0010"), MN1613_ONLY_RE);
  });
  test("TRST R0, 0x0010", () => {
    assert.throws(mn1610Err("        TRST R0, 0x0010"), MN1613_ONLY_RE);
  });
  test("SRBT R0, R1", () => {
    assert.throws(mn1610Err("        SRBT R0, R1"), MN1613_ONLY_RE);
  });
  test("DEBP R0, R0", () => {
    assert.throws(mn1610Err("        DEBP R0, R0"), MN1613_ONLY_RE);
  });
});

// ─── 特殊命令 ─────────────────────────────────────────────────────────────────

describe("MN1610 モード: 特殊命令はエラー", () => {
  test("BLK", () => {
    assert.throws(mn1610Err("        BLK"), MN1613_ONLY_RE);
  });
  test("RDR R0, (R1)", () => {
    assert.throws(mn1610Err("        RDR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("WTR R0, (R1)", () => {
    assert.throws(mn1610Err("        WTR R0, (R1)"), MN1613_ONLY_RE);
  });
});

// ─── セグメントレジスタ転送命令 ───────────────────────────────────────────────

describe("MN1610 モード: セグメントレジスタ転送命令はエラー", () => {
  test("LB CSBR, 0x0010", () => {
    assert.throws(mn1610Err("        LB CSBR, 0x0010"), MN1613_ONLY_RE);
  });
  test("LS NPP, 0x0010", () => {
    assert.throws(mn1610Err("        LS NPP, 0x0010"), MN1613_ONLY_RE);
  });
  test("STB CSBR, 0x0010", () => {
    assert.throws(mn1610Err("        STB CSBR, 0x0010"), MN1613_ONLY_RE);
  });
  test("STS NPP, 0x0010", () => {
    assert.throws(mn1610Err("        STS NPP, 0x0010"), MN1613_ONLY_RE);
  });
  test("CPYB R0, CSBR", () => {
    assert.throws(mn1610Err("        CPYB R0, CSBR"), MN1613_ONLY_RE);
  });
  test("CPYS R0, NPP", () => {
    assert.throws(mn1610Err("        CPYS R0, NPP"), MN1613_ONLY_RE);
  });
  test("CPYH R0, TCR", () => {
    assert.throws(mn1610Err("        CPYH R0, TCR"), MN1613_ONLY_RE);
  });
  test("SETB R0, CSBR", () => {
    assert.throws(mn1610Err("        SETB R0, CSBR"), MN1613_ONLY_RE);
  });
  test("SETS R0, NPP", () => {
    assert.throws(mn1610Err("        SETS R0, NPP"), MN1613_ONLY_RE);
  });
  test("SETH R0, TCR", () => {
    assert.throws(mn1610Err("        SETH R0, TCR"), MN1613_ONLY_RE);
  });
});

// ─── MN1613 拡張アドレッシングモード ─────────────────────────────────────────
//
// MN1613 で追加された 6 種のアドレッシングモードをそれぞれ使う命令が
// MN1610 モードでエラーになることを検証する。
//
//  (1) 16bit 直接番地指定         LD / STD / BD / BL 等の第 2 語に AD16
//  (2) レジスタ間接番地指定       LR R, (Ri)
//  (3) レジスタ間接拡張番地指定   LR R, BRn, (Ri)  ← ベースレジスタ明示
//  (4) 直接拡張番地指定           LD R, BRn, Exp   ← ベースレジスタ明示
//  (5) ポストインクリメント       LR R, (Ri)+
//  (6) プリデクリメント           STR R, -(Ri)
//  (7) 間接拡張番地指定           BD / BL（セグメント間分岐）
//  (8) レジスタ 2 重間接拡張      BR (Ri) / BALR (Ri)

describe("MN1610 モード: MN1613 拡張アドレッシングモード (1) 16bit 直接番地指定", () => {
  test("LD R0, 0x1234  (16bit 直接)", () => {
    assert.throws(mn1610Err("        LD R0, 0x1234"), MN1613_ONLY_RE);
  });
  test("STD R0, 0x1234  (16bit 直接)", () => {
    assert.throws(mn1610Err("        STD R0, 0x1234"), MN1613_ONLY_RE);
  });
  test("MVWI R0, 0x1234  (IM16 即値)", () => {
    assert.throws(mn1610Err("        MVWI R0, 0x1234"), MN1613_ONLY_RE);
  });
  test("AWI R0, 0x0001  (IM16 即値)", () => {
    assert.throws(mn1610Err("        AWI R0, 0x0001"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (2) レジスタ間接番地指定", () => {
  test("LR R0, (R1)  R1 間接", () => {
    assert.throws(mn1610Err("        LR R0, (R1)"), MN1613_ONLY_RE);
  });
  test("LR R0, (R2)  R2 間接", () => {
    assert.throws(mn1610Err("        LR R0, (R2)"), MN1613_ONLY_RE);
  });
  test("STR R0, (R3)  R3 間接ストア", () => {
    assert.throws(mn1610Err("        STR R0, (R3)"), MN1613_ONLY_RE);
  });
  test("STR R0, (R4)  R4 間接ストア", () => {
    assert.throws(mn1610Err("        STR R0, (R4)"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (3) レジスタ間接拡張（BRn 付き）", () => {
  test("LR R0, CSBR, (R1)  CSBR + R1 間接", () => {
    assert.throws(mn1610Err("        LR R0, CSBR, (R1)"), MN1613_ONLY_RE);
  });
  test("LR R0, SSBR, (R2)  SSBR + R2 間接", () => {
    assert.throws(mn1610Err("        LR R0, SSBR, (R2)"), MN1613_ONLY_RE);
  });
  test("LR R0, TSR0, (R3)  TSR0 + R3 間接", () => {
    assert.throws(mn1610Err("        LR R0, TSR0, (R3)"), MN1613_ONLY_RE);
  });
  test("STR R0, TSR1, (R4)  TSR1 + R4 間接ストア", () => {
    assert.throws(mn1610Err("        STR R0, TSR1, (R4)"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (4) 直接拡張番地指定（BRn 付き）", () => {
  test("LD R0, CSBR, 0x0100  CSBR + 16bit 直接", () => {
    assert.throws(mn1610Err("        LD R0, CSBR, 0x0100"), MN1613_ONLY_RE);
  });
  test("LD R0, SSBR, 0x0200  SSBR + 16bit 直接", () => {
    assert.throws(mn1610Err("        LD R0, SSBR, 0x0200"), MN1613_ONLY_RE);
  });
  test("STD R0, TSR0, 0x0300  TSR0 + 16bit 直接ストア", () => {
    assert.throws(mn1610Err("        STD R0, TSR0, 0x0300"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (5) ポストインクリメント", () => {
  test("LR R0, (R1)+  R1 間接ポストインクリメント", () => {
    assert.throws(mn1610Err("        LR R0, (R1)+"), MN1613_ONLY_RE);
  });
  test("LR R0, (R2)+  R2 間接ポストインクリメント", () => {
    assert.throws(mn1610Err("        LR R0, (R2)+"), MN1613_ONLY_RE);
  });
  test("LR R1, SSBR, (R3)+  BRn 付きポストインクリメント", () => {
    assert.throws(mn1610Err("        LR R1, SSBR, (R3)+"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (6) プリデクリメント", () => {
  test("STR R0, -(R1)  R1 間接プリデクリメント", () => {
    assert.throws(mn1610Err("        STR R0, -(R1)"), MN1613_ONLY_RE);
  });
  test("STR R0, -(R2)  R2 間接プリデクリメント", () => {
    assert.throws(mn1610Err("        STR R0, -(R2)"), MN1613_ONLY_RE);
  });
  test("STR R1, TSR0, -(R3)  BRn 付きプリデクリメント", () => {
    assert.throws(mn1610Err("        STR R1, TSR0, -(R3)"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (7) 間接拡張番地指定（セグメント間分岐）", () => {
  test("BD 0x0100  セグメント間分岐", () => {
    assert.throws(mn1610Err("        BD 0x0100"), MN1613_ONLY_RE);
  });
  test("BL 0x0200  セグメント間 BAL", () => {
    assert.throws(mn1610Err("        BL 0x0200"), MN1613_ONLY_RE);
  });
  test("BALD 0x0300  セグメント間分岐（BALD）", () => {
    assert.throws(mn1610Err("        BALD 0x0300"), MN1613_ONLY_RE);
  });
  test("BALL 0x0400  セグメント間 BAL（BALL）", () => {
    assert.throws(mn1610Err("        BALL 0x0400"), MN1613_ONLY_RE);
  });
});

describe("MN1610 モード: MN1613 拡張アドレッシングモード (8) レジスタ 2 重間接拡張", () => {
  test("BR (R1)  R1 2重間接分岐", () => {
    assert.throws(mn1610Err("        BR (R1)"), MN1613_ONLY_RE);
  });
  test("BR (R2)  R2 2重間接分岐", () => {
    assert.throws(mn1610Err("        BR (R2)"), MN1613_ONLY_RE);
  });
  test("BALR (R1)  R1 2重間接 BAL", () => {
    assert.throws(mn1610Err("        BALR (R1)"), MN1613_ONLY_RE);
  });
  test("BALR (R4)  R4 2重間接 BAL", () => {
    assert.throws(mn1610Err("        BALR (R4)"), MN1613_ONLY_RE);
  });
});

// ─── MN1610 互換命令はエラーにならないこと ────────────────────────────────────

describe("MN1610 モード: MN1610 互換命令はエラーにならない", () => {
  test("MVI（8bit即値転送）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        MVI R0, #42"));
  });
  test("L（ロード）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        L R0, 10"));
  });
  test("ST（ストア）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        ST R0, 10"));
  });
  test("A（加算）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        A R0, R1"));
  });
  test("B（分岐）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        B *0"));
  });
  test("BAL（リンク付き分岐）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        BAL *0"));
  });
  test("H（停止）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        H"));
  });
  test("RD（入力）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        RD R0, #0"));
  });
  test("WT（出力）はエラーにならない", () => {
    assert.doesNotThrow(mn1610Err("        WT R0, #0"));
  });
});
