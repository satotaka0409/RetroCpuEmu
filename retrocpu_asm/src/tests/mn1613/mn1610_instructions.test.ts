/**
 * MN1610 全33命令 エンコードテスト
 *
 * MN1610.md のビットパターン仕様に基づき、すべての命令語のエンコードを検証する。
 *
 * 実行方法:
 *   node --require tsx/cjs --test src/tests/mn1613/mn1610_instructions.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../../main/assembler";

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

/**
 * 1命令ソース（.org 0 付き）をアセンブルして最初のワード値を返す。
 * 例: asm1("        MVI R0, #42") → 0x082A
 */
function asm1(src: string): number {
  return assemble(`        .org 0\n${src}\n`, "mn1610").words[0].value;
}

/**
 * 複数行ソースをアセンブルして n 番目（0始まり）のワード値を返す。
 */
function asmAt(src: string, wordIndex = 0): number {
  return assemble(src, "mn1610").words[wordIndex].value;
}

// ─── メモリ参照命令（L / ST / B / BAL / IMS / DMS） ──────────────────────────
//
// ビットパターン: 1 X MMM RRR DDDDDDDD
//   X=1 → L, B, IMS  /  X=0 → ST, BAL, DMS
//   MMM: アドレッシングモード  RRR: レジスタ or 固定値
//
// エンコード: encodeMem(X, MMM, RRR, D) = 0x8000 | (X<<14) | (MMM<<11) | (RRR<<8) | D

describe("MN1610 命令: L（ロード）", () => {
  // L: X=1, RRR=レジスタ (STR 禁止)
  test("L R0, *5  ゼロページ直接(MMM=000)", () =>
    assert.equal(asm1("        L R0, *5"), 0xc005));
  test("L R1, *5  R1指定", () =>
    assert.equal(asm1("        L R1, *5"), 0xc105));
  test("L R2, *5  R2指定", () =>
    assert.equal(asm1("        L R2, *5"), 0xc205));
  test("L R3, *5  R3指定", () =>
    assert.equal(asm1("        L R3, *5"), 0xc305));
  test("L X0, *5  X0=R3 エイリアス", () =>
    assert.equal(asm1("        L X0, *5"), 0xc305));
  test("L R4, *5  R4指定", () =>
    assert.equal(asm1("        L R4, *5"), 0xc405));
  test("L X1, *5  X1=R4 エイリアス", () =>
    assert.equal(asm1("        L X1, *5"), 0xc405));
  test("L SP, *5  SP指定", () =>
    assert.equal(asm1("        L SP, *5"), 0xc505));
  test("L R0, *0  D=0", () => assert.equal(asm1("        L R0, *0"), 0xc000));
  test("L R0, *255  D=0xFF", () =>
    assert.equal(asm1("        L R0, *255"), 0xc0ff));
});

describe("MN1610 命令: ST（ストア）", () => {
  // ST: X=0, RRR=レジスタ (STR 禁止)
  test("ST R0, *5  ゼロページ直接", () =>
    assert.equal(asm1("        ST R0, *5"), 0x8005));
  test("ST R1, *5", () => assert.equal(asm1("        ST R1, *5"), 0x8105));
  test("ST SP, *5", () => assert.equal(asm1("        ST SP, *5"), 0x8505));
  test("ST R0, *0", () => assert.equal(asm1("        ST R0, *0"), 0x8000));
});

describe("MN1610 命令: B（分岐）", () => {
  // B: X=1, RRR=111(固定)
  test("B *5  ゼロページ直接(MMM=000)", () =>
    assert.equal(asm1("        B *5"), 0xc705));
  test("B *0", () => assert.equal(asm1("        B *0"), 0xc700));
  test("B [*5]  ゼロページ間接(MMM=010)", () =>
    assert.equal(asm1("        B [*5]"), 0xd705));
  test("B 5, X0  直接インデックス0", () =>
    assert.equal(asm1("        B 5, X0"), 0xe705));
  test("B 5, X1  直接インデックス1", () =>
    assert.equal(asm1("        B 5, X1"), 0xef05));
  test("B [*5], X0  間接インデックス0", () =>
    assert.equal(asm1("        B [*5], X0"), 0xf705));
  test("B [*5], X1  間接インデックス1", () =>
    assert.equal(asm1("        B [*5], X1"), 0xff05));

  test("B TARGET  相対直接(MMM=001) TARGET=addr3 rel=3", () =>
    assert.equal(
      asmAt(
        "        .org 0\n        B TARGET\n        H\n        H\nTARGET: H\n",
        0,
      ),
      0xcf03, // X=1, MMM=001, RRR=111, d=3（基準は当該命令）
    ));

  test("B [TARGET]  相対間接(MMM=011) rel=3", () =>
    assert.equal(
      asmAt(
        "        .org 0\n        B [TARGET]\n        H\n        H\nTARGET: H\n",
        0,
      ),
      0xdf03, // X=1, MMM=011, RRR=111, d=3
    ));
});

describe("MN1610 命令: BAL（分岐リンク）", () => {
  // BAL: X=0, RRR=111(固定)
  test("BAL *5  ゼロページ直接", () =>
    assert.equal(asm1("        BAL *5"), 0x8705));
  test("BAL *0", () => assert.equal(asm1("        BAL *0"), 0x8700));
  test("BAL [*5]", () => assert.equal(asm1("        BAL [*5]"), 0x9705));
  test("BAL 5, X0", () => assert.equal(asm1("        BAL 5, X0"), 0xa705));
  test("BAL 5, X1", () => assert.equal(asm1("        BAL 5, X1"), 0xaf05));

  test("BAL TARGET  相対直接 rel=3", () =>
    assert.equal(
      asmAt(
        "        .org 0\n        BAL TARGET\n        H\n        H\nTARGET: H\n",
        0,
      ),
      0x8f03, // X=0, MMM=001, RRR=111, d=3
    ));
});

describe("MN1610 命令: IMS（メモリインクリメント&スキップ）", () => {
  // IMS: X=1, RRR=110(固定)
  test("IMS *5  ゼロページ直接", () =>
    assert.equal(asm1("        IMS *5"), 0xc605));
  test("IMS *0", () => assert.equal(asm1("        IMS *0"), 0xc600));
  test("IMS [*5]", () => assert.equal(asm1("        IMS [*5]"), 0xd605));
  test("IMS 5, X0", () => assert.equal(asm1("        IMS 5, X0"), 0xe605));
});

describe("MN1610 命令: DMS（メモリデクリメント&スキップ）", () => {
  // DMS: X=0, RRR=110(固定)
  test("DMS *5  ゼロページ直接", () =>
    assert.equal(asm1("        DMS *5"), 0x8605));
  test("DMS *0", () => assert.equal(asm1("        DMS *0"), 0x8600));
  test("DMS [*5]", () => assert.equal(asm1("        DMS [*5]"), 0x9605));
  test("DMS 5, X0", () => assert.equal(asm1("        DMS 5, X0"), 0xa605));
});

// ─── 8種類のアドレッシングモード（L R0 で代表検証） ─────────────────────────
//
// MMM | 形式        | 意味
//  000 | *D         | ゼロページ直接
//  001 | d (相対)   | 相対直接
//  010 | [*D]       | ゼロページ間接
//  011 | [d] (相対) | 相対間接
//  100 | D, X0      | 直接インデックス0
//  101 | D, X1      | 直接インデックス1
//  110 | [*D], X0   | 間接インデックス0
//  111 | [*D], X1   | 間接インデックス1

describe("MN1610 アドレッシングモード 8種（L R0 で検証）", () => {
  // encodeMem(1, MMM, 0, D) = 0x8000 | 0x4000 | (MMM<<11) | D
  test("MMM=000 ゼロページ直接 *5", () =>
    assert.equal(asm1("        L R0, *5"), 0xc005));
  test("MMM=010 ゼロページ間接 [*5]", () =>
    assert.equal(asm1("        L R0, [*5]"), 0xd005));
  test("MMM=100 直接インデックス0 5, X0", () =>
    assert.equal(asm1("        L R0, 5, X0"), 0xe005));
  test("MMM=101 直接インデックス1 5, X1", () =>
    assert.equal(asm1("        L R0, 5, X1"), 0xe805));
  test("MMM=110 間接インデックス0 [*5], X0", () =>
    assert.equal(asm1("        L R0, [*5], X0"), 0xf005));
  test("MMM=111 間接インデックス1 [*5], X1", () =>
    assert.equal(asm1("        L R0, [*5], X1"), 0xf805));

  // 相対系はラベルで検証（TARGET=addr3, 命令=addr0, rel=3）
  const relSrc =
    "        .org 0\n        L R0, TARGET\n        H\n        H\nTARGET: H\n";
  const relISrc =
    "        .org 0\n        L R0, [TARGET]\n        H\n        H\nTARGET: H\n";
  test("MMM=001 相対直接 TARGET rel=3", () =>
    assert.equal(asmAt(relSrc, 0), 0xC803));
  test("MMM=011 相対間接 [TARGET] rel=3", () =>
    assert.equal(asmAt(relISrc, 0), 0xD803));
});

describe("MN1610 アドレッシングモード sdas 風書式", () => {
  test("MMM=010 (*5) ゼロページ間接", () =>
    assert.equal(asm1("        L R0, (*5)"), 0xd005));
  test("MMM=100 5(X0) 直接インデックス0", () =>
    assert.equal(asm1("        L R0, 5(X0)"), 0xe005));
  test("MMM=101 5(X1) 直接インデックス1", () =>
    assert.equal(asm1("        L R0, 5(X1)"), 0xe805));
  test("MMM=110 (*5)(X0) 間接インデックス0", () =>
    assert.equal(asm1("        L R0, (*5)(X0)"), 0xf005));
  test("MMM=111 (*5)(X1) 間接インデックス1", () =>
    assert.equal(asm1("        L R0, (*5)(X1)"), 0xf805));
  test("B (*5) ゼロページ間接", () =>
    assert.equal(asm1("        B (*5)"), 0xd705));
  test("B 5(X0) 直接インデックス0", () =>
    assert.equal(asm1("        B 5(X0)"), 0xe705));
  test("B (*5)(X1) 間接インデックス1", () =>
    assert.equal(asm1("        B (*5)(X1)"), 0xff05));

  const relParen =
    "        .org 0\n        L R0, (TARGET)\n        H\n        H\nTARGET: H\n";
  const bParen =
    "        .org 0\n        B (TARGET)\n        H\n        H\nTARGET: H\n";
  test("MMM=011 (TARGET) 相対間接", () =>
    assert.equal(asmAt(relParen, 0), 0xd803));
  test("B (TARGET) 相対間接", () => assert.equal(asmAt(bParen, 0), 0xdf03));
});

// ─── 2項演算命令 ─────────────────────────────────────────────────────────────
//
// ビットパターン: 0 1 OOOOO Rd SSSS Xs Rs  (Xビットで命令区別)
// エンコード: op5(opcode, Rd, skip, tail)
//   tail = {A:0x8|Rs, S:Rs, C:0x8|Rs, CB:Rs, ...}

describe("MN1610 命令: A（加算）", () => {
  test("A R0, R1", () => assert.equal(asm1("        A R0, R1"), 0x5809));
  test("A R0, R2", () => assert.equal(asm1("        A R0, R2"), 0x580a));
  test("A R0, R3", () => assert.equal(asm1("        A R0, R3"), 0x580b));
  test("A R0, R4", () => assert.equal(asm1("        A R0, R4"), 0x580c));
  test("A R0, SP", () => assert.equal(asm1("        A R0, SP"), 0x580d));
  test("A R0, STR", () => assert.equal(asm1("        A R0, STR"), 0x580e));
  test("A R2, R1", () => assert.equal(asm1("        A R2, R1"), 0x5a09));
  test("A SP, R1", () => assert.equal(asm1("        A SP, R1"), 0x5d09));
  test("A STR, R0", () => assert.equal(asm1("        A STR, R0"), 0x5e08));
  test("A R0, R1, Z", () => assert.equal(asm1("        A R0, R1, Z"), 0x5849));
  test("A R0, R1, NZ", () =>
    assert.equal(asm1("        A R0, R1, NZ"), 0x5859));
});

describe("MN1610 命令: S（減算）", () => {
  test("S R0, R1", () => assert.equal(asm1("        S R0, R1"), 0x5801));
  test("S R0, R2", () => assert.equal(asm1("        S R0, R2"), 0x5802));
  test("S R2, R1", () => assert.equal(asm1("        S R2, R1"), 0x5a01));
  test("S R0, R1, M", () => assert.equal(asm1("        S R0, R1, M"), 0x5821));
  test("S R0, R1, PZ", () =>
    assert.equal(asm1("        S R0, R1, PZ"), 0x5831));
});

describe("MN1610 命令: C（比較 16bit）", () => {
  test("C R0, R1", () => assert.equal(asm1("        C R0, R1"), 0x5009));
  test("C R1, R0", () => assert.equal(asm1("        C R1, R0"), 0x5108));
  test("C R0, R1, LP", () =>
    assert.equal(asm1("        C R0, R1, LP"), 0x50d9));
  test("C R0, R1, LM", () =>
    assert.equal(asm1("        C R0, R1, LM"), 0x50f9));
});

describe("MN1610 命令: CB（比較 下位8bit）", () => {
  test("CB R0, R1", () => assert.equal(asm1("        CB R0, R1"), 0x5001));
  test("CB R1, R2", () => assert.equal(asm1("        CB R1, R2"), 0x5102));
  test("CB R0, R1, Z", () =>
    assert.equal(asm1("        CB R0, R1, Z"), 0x5041));
});

describe("MN1610 命令: MV（転送 16bit）", () => {
  test("MV R0, R1", () => assert.equal(asm1("        MV R0, R1"), 0x7809));
  test("MV R1, R0", () => assert.equal(asm1("        MV R1, R0"), 0x7908));
  test("MV STR, R0", () => assert.equal(asm1("        MV STR, R0"), 0x7e08));
  test("MV R0, STR", () => assert.equal(asm1("        MV R0, STR"), 0x780e));
  test("MV R0, R1, EZ", () =>
    assert.equal(asm1("        MV R0, R1, EZ"), 0x7889));
  test("MV R0, R1, ENZ", () =>
    assert.equal(asm1("        MV R0, R1, ENZ"), 0x7899));
});

describe("MN1610 命令: MVB（転送 下位8bit）", () => {
  test("MVB R0, R1", () => assert.equal(asm1("        MVB R0, R1"), 0x7801));
  test("MVB R1, R2", () => assert.equal(asm1("        MVB R1, R2"), 0x7902));
  test("MVB R0, R1, Z", () =>
    assert.equal(asm1("        MVB R0, R1, Z"), 0x7841));
});

describe("MN1610 命令: BSWP（バイトスワップ転送）", () => {
  test("BSWP R0, R1", () => assert.equal(asm1("        BSWP R0, R1"), 0x7009));
  test("BSWP R1, R2", () => assert.equal(asm1("        BSWP R1, R2"), 0x710a));
  test("BSWP R0, R1, Z", () =>
    assert.equal(asm1("        BSWP R0, R1, Z"), 0x7049));
});

describe("MN1610 命令: DSWP（デジットスワップ転送）", () => {
  test("DSWP R0, R1", () => assert.equal(asm1("        DSWP R0, R1"), 0x7001));
  test("DSWP R1, R2", () => assert.equal(asm1("        DSWP R1, R2"), 0x7102));
  test("DSWP R0, R1, P", () =>
    assert.equal(asm1("        DSWP R0, R1, P"), 0x7071));
});

describe("MN1610 命令: LAD（BCD補正値ロード）", () => {
  test("LAD R0, R1", () => assert.equal(asm1("        LAD R0, R1"), 0x6801));
  test("LAD R1, R2", () => assert.equal(asm1("        LAD R1, R2"), 0x6902));
  test("LAD R0, R1, Z", () =>
    assert.equal(asm1("        LAD R0, R1, Z"), 0x6841));
});

describe("MN1610 命令: AND（論理積）", () => {
  test("AND R0, R1", () => assert.equal(asm1("        AND R0, R1"), 0x6809));
  test("AND R1, R2", () => assert.equal(asm1("        AND R1, R2"), 0x690a));
  test("AND R0, R1, NZ", () =>
    assert.equal(asm1("        AND R0, R1, NZ"), 0x6859));
});

describe("MN1610 命令: OR（論理和）", () => {
  test("OR R0, R1", () => assert.equal(asm1("        OR R0, R1"), 0x6009));
  test("OR R2, R3", () => assert.equal(asm1("        OR R2, R3"), 0x620b));
  test("OR R0, R1, M", () =>
    assert.equal(asm1("        OR R0, R1, M"), 0x6029));
});

describe("MN1610 命令: EOR（排他的論理和）", () => {
  test("EOR R0, R1", () => assert.equal(asm1("        EOR R0, R1"), 0x6001));
  test("EOR R0, R0 (CLR)", () =>
    assert.equal(asm1("        EOR R0, R0"), 0x6000));
  test("EOR R1, R1 (CLR)", () =>
    assert.equal(asm1("        EOR R1, R1"), 0x6101));
  test("EOR R0, R1, SKP", () =>
    assert.equal(asm1("        EOR R0, R1, SKP"), 0x6011));
});

// ─── スキップ条件 全16種（A R0, R1 で検証） ──────────────────────────────────
//
// 仕様: SSSS | 記号 | 意味
//  0000: なし / 0001:SKP / 0010:M / 0011:PZ / 0100:Z,E
//  0101:NZ,NE / 0110:MZ / 0111:P / 1000:EZ / 1001:ENZ
//  1010:OZ / 1011:ONZ / 1100:LMZ / 1101:LP / 1110:LPZ / 1111:LM

describe("MN1610 スキップ条件 全16種", () => {
  // A R0, R1 の基本パターンは 0x5809
  // skip フィールドは bits 8-11: 0x5800 | (skip<<4) | 0x09
  const base = (skip: number) => 0x5800 | (skip << 4) | 0x09;

  test("skip なし (省略)", () =>
    assert.equal(asm1("        A R0, R1"), base(0x0)));
  test("SKP  無条件", () =>
    assert.equal(asm1("        A R0, R1, SKP"), base(0x1)));
  test("M    結果が負", () =>
    assert.equal(asm1("        A R0, R1, M"), base(0x2)));
  test("PZ   正または零", () =>
    assert.equal(asm1("        A R0, R1, PZ"), base(0x3)));
  test("Z    結果が零", () =>
    assert.equal(asm1("        A R0, R1, Z"), base(0x4)));
  test("E    結果が零(別名)", () =>
    assert.equal(asm1("        A R0, R1, E"), base(0x4)));
  test("NZ   零でない", () =>
    assert.equal(asm1("        A R0, R1, NZ"), base(0x5)));
  test("NE   零でない(別名)", () =>
    assert.equal(asm1("        A R0, R1, NE"), base(0x5)));
  test("MZ   負または零", () =>
    assert.equal(asm1("        A R0, R1, MZ"), base(0x6)));
  test("P    正", () => assert.equal(asm1("        A R0, R1, P"), base(0x7)));
  test("EZ   E=0", () => assert.equal(asm1("        A R0, R1, EZ"), base(0x8)));
  test("ENZ  E≠0", () =>
    assert.equal(asm1("        A R0, R1, ENZ"), base(0x9)));
  test("OZ   OVF=0", () =>
    assert.equal(asm1("        A R0, R1, OZ"), base(0xa)));
  test("ONZ  OVF≠0", () =>
    assert.equal(asm1("        A R0, R1, ONZ"), base(0xb)));
  test("LMZ  ≦(無符号)", () =>
    assert.equal(asm1("        A R0, R1, LMZ"), base(0xc)));
  test("LP   >(無符号)", () =>
    assert.equal(asm1("        A R0, R1, LP"), base(0xd)));
  test("LPZ  ≧(無符号)", () =>
    assert.equal(asm1("        A R0, R1, LPZ"), base(0xe)));
  test("LM   <(無符号)", () =>
    assert.equal(asm1("        A R0, R1, LM"), base(0xf)));
});

// ─── シフト命令（SR / SL） ────────────────────────────────────────────────────
//
// ビットパターン:
//   SR: 0 0 1 0 0 RRR SSSS 1 0 EE = 0x2000 | (RRR<<8) | (skip<<4) | 0x08 | EE
//   SL: 0 0 1 0 0 RRR SSSS 1 1 EE = 0x2000 | (RRR<<8) | (skip<<4) | 0x0C | EE
//
// EE: 00=変化なし / 01=RE(0→E) / 10=SE(1→E) / 11=CE(NOT E)

describe("MN1610 命令: SR（右シフト）", () => {
  test("SR R0              基本", () =>
    assert.equal(asm1("        SR R0"), 0x2008));
  test("SR R1", () => assert.equal(asm1("        SR R1"), 0x2108));
  test("SR SP", () => assert.equal(asm1("        SR SP"), 0x2508));
  test("SR STR", () => assert.equal(asm1("        SR STR"), 0x2608));
  test("SR R0, RE        E←0", () =>
    assert.equal(asm1("        SR R0, RE"), 0x2009));
  test("SR R0, SE        E←1", () =>
    assert.equal(asm1("        SR R0, SE"), 0x200a));
  test("SR R0, CE        E←~E", () =>
    assert.equal(asm1("        SR R0, CE"), 0x200b));
  test("SR R0, Z         skip付き", () =>
    assert.equal(asm1("        SR R0, Z"), 0x2048));
  test("SR R0, RE, Z     EM+skip", () =>
    assert.equal(asm1("        SR R0, RE, Z"), 0x2049));
  test("SR R0, SE, M", () =>
    assert.equal(asm1("        SR R0, SE, M"), 0x202a));
  test("SR R0, CE, NZ", () =>
    assert.equal(asm1("        SR R0, CE, NZ"), 0x205b));
});

describe("MN1610 命令: SL（左シフト）", () => {
  test("SL R0              基本", () =>
    assert.equal(asm1("        SL R0"), 0x200c));
  test("SL R1", () => assert.equal(asm1("        SL R1"), 0x210c));
  test("SL R0, RE", () => assert.equal(asm1("        SL R0, RE"), 0x200d));
  test("SL R0, SE", () => assert.equal(asm1("        SL R0, SE"), 0x200e));
  test("SL R0, CE", () => assert.equal(asm1("        SL R0, CE"), 0x200f));
  test("SL R0, Z", () => assert.equal(asm1("        SL R0, Z"), 0x204c));
  test("SL R0, RE, Z", () =>
    assert.equal(asm1("        SL R0, RE, Z"), 0x204d));
  test("SL R0, SKP", () => assert.equal(asm1("        SL R0, SKP"), 0x201c));
  test("SL STR, CE, P", () =>
    assert.equal(asm1("        SL STR, CE, P"), 0x267f));
});

// ─── ビット操作・即値加減算（SBIT / RBIT / TBIT / AI / SI） ──────────────────
//
// ビットパターン:
//   SBIT: 0 0 1 1 1 RRR SSSS NNNN = 0x3800 | (RRR<<8) | (skip<<4) | N4
//   RBIT: 0 0 1 1 0 RRR SSSS NNNN = 0x3000 | ...
//   TBIT: 0 0 1 0 1 RRR SSSS NNNN = 0x2800 | ...
//   AI:   0 1 0 0 1 RRR SSSS NNNN = 0x4800 | ...
//   SI:   0 1 0 0 0 RRR SSSS NNNN = 0x4000 | ...

describe("MN1610 命令: SBIT（ビットセット）", () => {
  test("SBIT R0, #0", () => assert.equal(asm1("        SBIT R0, #0"), 0x3800));
  test("SBIT R0, #5", () => assert.equal(asm1("        SBIT R0, #5"), 0x3805));
  test("SBIT R0, #15", () =>
    assert.equal(asm1("        SBIT R0, #15"), 0x380f));
  test("SBIT R1, #5", () => assert.equal(asm1("        SBIT R1, #5"), 0x3905));
  test("SBIT STR, #5", () =>
    assert.equal(asm1("        SBIT STR, #5"), 0x3e05));
  test("SBIT R0, #5, Z", () =>
    assert.equal(asm1("        SBIT R0, #5, Z"), 0x3845));
  test("SBIT R0, #5, NZ", () =>
    assert.equal(asm1("        SBIT R0, #5, NZ"), 0x3855));
});

describe("MN1610 命令: RBIT（ビットリセット）", () => {
  test("RBIT R0, #0", () => assert.equal(asm1("        RBIT R0, #0"), 0x3000));
  test("RBIT R0, #5", () => assert.equal(asm1("        RBIT R0, #5"), 0x3005));
  test("RBIT R0, #15", () =>
    assert.equal(asm1("        RBIT R0, #15"), 0x300f));
  test("RBIT R1, #7", () => assert.equal(asm1("        RBIT R1, #7"), 0x3107));
  test("RBIT R0, #5, Z", () =>
    assert.equal(asm1("        RBIT R0, #5, Z"), 0x3045));
});

describe("MN1610 命令: TBIT（ビットテスト）", () => {
  test("TBIT R0, #0", () => assert.equal(asm1("        TBIT R0, #0"), 0x2800));
  test("TBIT R0, #5", () => assert.equal(asm1("        TBIT R0, #5"), 0x2805));
  test("TBIT R0, #15", () =>
    // MN1613 ビット15 = LSB（マスク 0x0001）。即値はビット番号で 15。
    assert.equal(asm1("        TBIT R0, #15"), 0x280f));
  test("TBIT R1, #3", () => assert.equal(asm1("        TBIT R1, #3"), 0x2903));
  test("TBIT STR, #0, Z", () =>
    assert.equal(asm1("        TBIT STR, #0, Z"), 0x2e40));
  test("TBIT R0, #5, Z", () =>
    assert.equal(asm1("        TBIT R0, #5, Z"), 0x2845));
  test("TBIT R0, #5, NZ", () =>
    assert.equal(asm1("        TBIT R0, #5, NZ"), 0x2855));
});

describe("MN1610 命令: AI（即値加算 4bit）", () => {
  test("AI R0, #0", () => assert.equal(asm1("        AI R0, #0"), 0x4800));
  test("AI R0, #1", () => assert.equal(asm1("        AI R0, #1"), 0x4801));
  test("AI R0, #5", () => assert.equal(asm1("        AI R0, #5"), 0x4805));
  test("AI R0, #15", () => assert.equal(asm1("        AI R0, #15"), 0x480f));
  test("AI R1, #5", () => assert.equal(asm1("        AI R1, #5"), 0x4905));
  test("AI SP, #3", () => assert.equal(asm1("        AI SP, #3"), 0x4d03));
  test("AI STR, #1", () => assert.equal(asm1("        AI STR, #1"), 0x4e01));
  // AI はフラグ変化なし → スキップ条件は機能しないが構文上許可される
  test("AI R0, #5, Z", () =>
    assert.equal(asm1("        AI R0, #5, Z"), 0x4845));
});

describe("MN1610 命令: SI（即値減算 4bit）", () => {
  test("SI R0, #0", () => assert.equal(asm1("        SI R0, #0"), 0x4000));
  test("SI R0, #1", () => assert.equal(asm1("        SI R0, #1"), 0x4001));
  test("SI R0, #5", () => assert.equal(asm1("        SI R0, #5"), 0x4005));
  test("SI R0, #15", () => assert.equal(asm1("        SI R0, #15"), 0x400f));
  test("SI R1, #5", () => assert.equal(asm1("        SI R1, #5"), 0x4105));
  test("SI R0, #1, Z", () =>
    assert.equal(asm1("        SI R0, #1, Z"), 0x4041));
  test("SI R1, #1, Z", () =>
    assert.equal(asm1("        SI R1, #1, Z"), 0x4141)); // sum1to10 で使用
});

// ─── 入出力・即値転送（RD / WT / MVI） ───────────────────────────────────────
//
// ビットパターン:
//   RD:  0 0 0 1 1 RRR NNNNNNNN = 0x1800 | (RRR<<8) | N8
//   WT:  0 0 0 1 0 RRR NNNNNNNN = 0x1000 | (RRR<<8) | N8
//   MVI: 0 0 0 0 1 RRR NNNNNNNN = 0x0800 | (RRR<<8) | N8

describe("MN1610 命令: RD（I/O読み込み）", () => {
  test("RD R0, #0", () => assert.equal(asm1("        RD R0, #0"), 0x1800));
  test("RD R0, #7", () => assert.equal(asm1("        RD R0, #7"), 0x1807));
  test("RD R0, #255", () => assert.equal(asm1("        RD R0, #255"), 0x18ff));
  test("RD R1, #7", () => assert.equal(asm1("        RD R1, #7"), 0x1907));
  test("RD R2, #7", () => assert.equal(asm1("        RD R2, #7"), 0x1a07));
  test("RD R3, #7", () => assert.equal(asm1("        RD R3, #7"), 0x1b07));
  test("RD R4, #7", () => assert.equal(asm1("        RD R4, #7"), 0x1c07));
  test("RD SP, #7", () => assert.equal(asm1("        RD SP, #7"), 0x1d07));
  test("RD STR, #7", () => assert.equal(asm1("        RD STR, #7"), 0x1e07));
});

describe("MN1610 命令: WT（I/O書き込み）", () => {
  test("WT R0, #0", () => assert.equal(asm1("        WT R0, #0"), 0x1000));
  test("WT R0, #7", () => assert.equal(asm1("        WT R0, #7"), 0x1007));
  test("WT R0, #255", () => assert.equal(asm1("        WT R0, #255"), 0x10ff));
  test("WT R1, #7", () => assert.equal(asm1("        WT R1, #7"), 0x1107));
  test("WT R2, #7", () => assert.equal(asm1("        WT R2, #7"), 0x1207));
  test("WT SP, #7", () => assert.equal(asm1("        WT SP, #7"), 0x1507));
  test("WT STR, #7", () => assert.equal(asm1("        WT STR, #7"), 0x1607));
});

describe("MN1610 命令: MVI（即値ロード 下位8bit）", () => {
  test("MVI R0, #0", () => assert.equal(asm1("        MVI R0, #0"), 0x0800));
  test("MVI R0, #42", () => assert.equal(asm1("        MVI R0, #42"), 0x082a));
  test("MVI R0, #255", () =>
    assert.equal(asm1("        MVI R0, #255"), 0x08ff));
  test("MVI R1, #0", () => assert.equal(asm1("        MVI R1, #0"), 0x0900));
  test("MVI R1, #10", () => assert.equal(asm1("        MVI R1, #10"), 0x090a)); // sum1to10 で使用
  test("MVI R2, #42", () => assert.equal(asm1("        MVI R2, #42"), 0x0a2a));
  test("MVI R3, #42", () => assert.equal(asm1("        MVI R3, #42"), 0x0b2a));
  test("MVI R4, #42", () => assert.equal(asm1("        MVI R4, #42"), 0x0c2a));
  test("MVI SP, #42", () => assert.equal(asm1("        MVI SP, #42"), 0x0d2a));
  test("MVI STR, #42", () =>
    assert.equal(asm1("        MVI STR, #42"), 0x0e2a));
  test("MVI X0, #5", () => assert.equal(asm1("        MVI X0, #5"), 0x0b05)); // X0=R3
  test("MVI X1, #5", () => assert.equal(asm1("        MVI X1, #5"), 0x0c05)); // X1=R4
});

// ─── その他命令（LPSW / H / PUSH / POP / RET） ────────────────────────────────
//
// ビットパターン（いずれも opcode=00100）:
//   LPSW: 0 0 1 0 0 0 0 0 0 0 0 0 0 1 L L  = 0x2004 | LL
//   H:    0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0  = 0x2000
//   PUSH: 0 0 1 0 0 RRR 0 0 0 0 0 0 0 1    = 0x2000 | (RRR<<8) | 0x01
//   POP:  0 0 1 0 0 RRR 0 0 0 0 0 0 1 0    = 0x2000 | (RRR<<8) | 0x02
//   RET:  0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 1  = 0x2003

describe("MN1610 命令: LPSW（割り込みリターン）", () => {
  // 仕様: 0 0 1 0 0 0 0 0 0 0 0 0 0 1 L L = 0x2004 | LL
  test("LPSW 0  レベル0 → 0x2004", () =>
    assert.equal(asm1("        LPSW 0"), 0x2004));
  test("LPSW 1  レベル1 → 0x2005", () =>
    assert.equal(asm1("        LPSW 1"), 0x2005));
  test("LPSW 2  レベル2 → 0x2006", () =>
    assert.equal(asm1("        LPSW 2"), 0x2006));
  test("LPSW 3  LL=11 → 0x2007", () =>
    assert.equal(asm1("        LPSW 3"), 0x2007));
});

describe("MN1610 命令: H（停止）", () => {
  test("H → 0x2000", () => assert.equal(asm1("        H"), 0x2000));
});

describe("MN1610 命令: PUSH（スタックプッシュ）", () => {
  test("PUSH R0", () => assert.equal(asm1("        PUSH R0"), 0x2001));
  test("PUSH R1", () => assert.equal(asm1("        PUSH R1"), 0x2101));
  test("PUSH R2", () => assert.equal(asm1("        PUSH R2"), 0x2201));
  test("PUSH R3", () => assert.equal(asm1("        PUSH R3"), 0x2301));
  test("PUSH X0", () => assert.equal(asm1("        PUSH X0"), 0x2301)); // X0=R3
  test("PUSH R4", () => assert.equal(asm1("        PUSH R4"), 0x2401));
  test("PUSH X1", () => assert.equal(asm1("        PUSH X1"), 0x2401)); // X1=R4
  test("PUSH SP", () => assert.equal(asm1("        PUSH SP"), 0x2501));
  test("PUSH STR", () => assert.equal(asm1("        PUSH STR"), 0x2601));
});

describe("MN1610 命令: POP（スタックポップ）", () => {
  test("POP R0", () => assert.equal(asm1("        POP R0"), 0x2002));
  test("POP R1", () => assert.equal(asm1("        POP R1"), 0x2102));
  test("POP R2", () => assert.equal(asm1("        POP R2"), 0x2202));
  test("POP R3", () => assert.equal(asm1("        POP R3"), 0x2302));
  test("POP X0", () => assert.equal(asm1("        POP X0"), 0x2302)); // X0=R3
  test("POP R4", () => assert.equal(asm1("        POP R4"), 0x2402));
  test("POP X1", () => assert.equal(asm1("        POP X1"), 0x2402)); // X1=R4
  test("POP SP", () => assert.equal(asm1("        POP SP"), 0x2502));
  test("POP STR", () => assert.equal(asm1("        POP STR"), 0x2602));
});

describe("MN1610 命令: RET（サブルーチンリターン）", () => {
  test("RET → 0x2003", () => assert.equal(asm1("        RET"), 0x2003));
});
