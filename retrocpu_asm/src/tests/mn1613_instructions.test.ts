/**
 * MN1613 新設命令 エンコードテスト
 *
 * MN1613.md のビットパターン仕様に基づき、MN1613 で新設された全命令のエンコードを検証する。
 * MN1610 互換命令は mn1610_instructions.test.ts でカバー済み。
 *
 * 実行方法:
 *   node --require tsx/cjs --test src/tests/mn1613_instructions.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../main/assembler";

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

/** 1語命令をアセンブルして word[0] を返す */
function asm1(src: string): number {
  return assemble(`        .org 0\n${src}\n`).words[0].value;
}

/** 2語命令をアセンブルして [word0, word1] を返す */
function asm2(src: string): [number, number] {
  const r = assemble(`        .org 0\n${src}\n`);
  return [r.words[0].value, r.words[1].value];
}

// ─── データ転送命令（2語） ────────────────────────────────────────────────────
//
// LD:  00100 111 00BB 1RRR | AD16  =  0x2700 | (BB<<4) | 0x08 | RRR
// STD: 00100 111 01BB 1RRR | AD16  =  0x2740 | (BB<<4) | 0x08 | RRR

describe("MN1613 命令: LD（セグメント直接ロード）", () => {
  test("LD R0, 0x0100       CSBR(00), R0", () =>
    assert.deepEqual(asm2("        LD R0, 0x0100"), [0x2708, 0x0100]));
  test("LD R1, 0x0200       CSBR(00), R1", () =>
    assert.deepEqual(asm2("        LD R1, 0x0200"), [0x2709, 0x0200]));
  test("LD R0, SSBR, 0x0100 SSBR(01), R0", () =>
    assert.deepEqual(asm2("        LD R0, SSBR, 0x0100"), [0x2718, 0x0100]));
  test("LD R0, 0x0100(SSBR) sdas風 addr(BRn)", () =>
    assert.deepEqual(asm2("        LD R0, 0x0100(SSBR)"), [0x2718, 0x0100]));
  test("LD R0, TSR0, 0x0300 TSR0(10), R0", () =>
    assert.deepEqual(asm2("        LD R0, TSR0, 0x0300"), [0x2728, 0x0300]));
  test("LD R0, 0x0300(TSR0) sdas風", () =>
    assert.deepEqual(asm2("        LD R0, 0x0300(TSR0)"), [0x2728, 0x0300]));
  test("LD R0, TSR1, 0x0400 TSR1(11), R0", () =>
    assert.deepEqual(asm2("        LD R0, TSR1, 0x0400"), [0x2738, 0x0400]));
});

describe("MN1613 命令: STD（セグメント直接ストア）", () => {
  test("STD R0, 0x0100       CSBR, R0", () =>
    assert.deepEqual(asm2("        STD R0, 0x0100"), [0x2748, 0x0100]));
  test("STD R1, SSBR, 0x0200 SSBR, R1", () =>
    assert.deepEqual(asm2("        STD R1, SSBR, 0x0200"), [0x2759, 0x0200]));
  test("STD R1, 0x0200(SSBR) sdas風", () =>
    assert.deepEqual(asm2("        STD R1, 0x0200(SSBR)"), [0x2759, 0x0200]));
});

// ─── データ転送命令（1語、レジスタ間接） ─────────────────────────────────────
//
// LR:  00100 RRR mmBB 00ii  =  0x2000 | (RRR<<8) | (mm<<6) | (BB<<4) | ii
// STR: 00100 RRR mmBB 01ii  =  0x2000 | (RRR<<8) | (mm<<6) | (BB<<4) | 0x04 | ii

describe("MN1613 命令: LR（レジスタ間接ロード）", () => {
  test("LR R0, (R1)       通常間接 mm=01, ii=R1=0", () =>
    assert.equal(asm1("        LR R0, (R1)"), 0x2040));
  test("LR R0, (R2)       ii=R2=1", () =>
    assert.equal(asm1("        LR R0, (R2)"), 0x2041));
  test("LR R0, (R3)       ii=R3=2", () =>
    assert.equal(asm1("        LR R0, (R3)"), 0x2042));
  test("LR R0, (R4)       ii=R4=3", () =>
    assert.equal(asm1("        LR R0, (R4)"), 0x2043));
  test("LR R0, (R1)+      ポストインクリメント mm=11", () =>
    assert.equal(asm1("        LR R0, (R1)+"), 0x20c0));
  test("LR R0, -(R1)      プリデクリメント mm=10", () =>
    assert.equal(asm1("        LR R0, -(R1)"), 0x2080));
  test("LR R1, (R2)       RRR=R1", () =>
    assert.equal(asm1("        LR R1, (R2)"), 0x2141));
  test("LR R0, SSBR, (R1) BB=SSBR=1", () =>
    assert.equal(asm1("        LR R0, SSBR, (R1)"), 0x2050));
  test("LR R0, TSR0, (R2) BB=TSR0=2", () =>
    assert.equal(asm1("        LR R0, TSR0, (R2)"), 0x2061));
});

describe("MN1613 命令: STR（レジスタ間接ストア）", () => {
  test("STR R0, (R1)       mm=01, ii=0, indirBit=0x04", () =>
    assert.equal(asm1("        STR R0, (R1)"), 0x2044));
  test("STR R0, (R1)+", () =>
    assert.equal(asm1("        STR R0, (R1)+"), 0x20c4));
  test("STR R0, -(R2)     mm=10, ii=1", () =>
    assert.equal(asm1("        STR R0, -(R2)"), 0x2085));
  test("STR R1, SSBR, (R1) BB=1", () =>
    assert.equal(asm1("        STR R1, SSBR, (R1)"), 0x2154));
});

// ─── Move 系（レジスタ間接・即値） ───────────────────────────────────────────
//
// MVWR: 01111 111 kkkk 10ii  =  op5(15, 7, skip, 0x08|ii)
// MVWI: 01111 ddd kkkk 0111 | IM16
// MVBR: 01111 111 kkkk 00ii  =  op5(15, 7, skip, ii)
// BSWR: 01110 111 kkkk 10ii  =  op5(14, 7, skip, 0x08|ii)
// DSWR: 01110 111 kkkk 00ii  =  op5(14, 7, skip, ii)

describe("MN1613 命令: MVWR（ワード間接転送）", () => {
  test("MVWR R0, (R1)     skip=0, ii=0", () =>
    assert.equal(asm1("        MVWR R0, (R1)"), 0x7f08));
  test("MVWR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        MVWR R0, (R2)"), 0x7f09));
  test("MVWR R0, (R1), Z  skip=Z=4", () =>
    assert.equal(asm1("        MVWR R0, (R1), Z"), 0x7f48));
});

describe("MN1613 命令: MVWI（ワード即値転送）", () => {
  test("MVWI R0, 0x1234   word1=0x7807, word2=0x1234", () =>
    assert.deepEqual(asm2("        MVWI R0, 0x1234"), [0x7807, 0x1234]));
  test("MVWI R1, 0x5678   word1=0x7907", () =>
    assert.deepEqual(asm2("        MVWI R1, 0x5678"), [0x7907, 0x5678]));
  test("MVWI R0, 0x1234, Z skip=Z=4", () =>
    assert.deepEqual(asm2("        MVWI R0, 0x1234, Z"), [0x7847, 0x1234]));
});

describe("MN1613 命令: MVBR（バイト間接転送）", () => {
  test("MVBR R0, (R1)     tail=0x00|0=0", () =>
    assert.equal(asm1("        MVBR R0, (R1)"), 0x7f00));
  test("MVBR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        MVBR R0, (R2)"), 0x7f01));
});

describe("MN1613 命令: BSWR（バイトスワップ間接）", () => {
  test("BSWR R0, (R1)     op5(14,7,0,0x08|0)", () =>
    assert.equal(asm1("        BSWR R0, (R1)"), 0x7708));
  test("BSWR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        BSWR R0, (R2)"), 0x7709));
});

describe("MN1613 命令: DSWR（デジットスワップ間接）", () => {
  test("DSWR R0, (R1)     op5(14,7,0,0x00)", () =>
    assert.equal(asm1("        DSWR R0, (R1)"), 0x7700));
  test("DSWR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        DSWR R0, (R2)"), 0x7701));
});

// ─── スタック命令 ─────────────────────────────────────────────────────────────

describe("MN1613 命令: PSHM / POPM", () => {
  test("PSHM → 0x170F", () => assert.equal(asm1("        PSHM"), 0x170f));
  test("POPM → 0x1707", () => assert.equal(asm1("        POPM"), 0x1707));
});

// ─── 整数演算（レジスタ間接・即値） ──────────────────────────────────────────
//
// AWR: 01011 111 kkkk 10ii  =  op5(11,7,skip,0x08|ii)
// AWI: 01011 ddd kkkk 1111 | IM16
// SWR: 01011 111 kkkk 00ii
// SWI: 01011 ddd kkkk 0111 | IM16

describe("MN1613 命令: AWR（ワード間接加算）", () => {
  test("AWR R0, (R1)      op5(11,7,0,0x08)", () =>
    assert.equal(asm1("        AWR R0, (R1)"), 0x5f08));
  test("AWR R0, (R2)      ii=1", () =>
    assert.equal(asm1("        AWR R0, (R2)"), 0x5f09));
  test("AWR R0, (R1), Z   skip=Z=4", () =>
    assert.equal(asm1("        AWR R0, (R1), Z"), 0x5f48));
});

describe("MN1613 命令: AWI（ワード即値加算）", () => {
  test("AWI R0, 0x0010    word1=0x580F, word2=0x0010", () =>
    assert.deepEqual(asm2("        AWI R0, 0x0010"), [0x580f, 0x0010]));
  test("AWI R1, 0x0020    word1=0x590F", () =>
    assert.deepEqual(asm2("        AWI R1, 0x0020"), [0x590f, 0x0020]));
  test("AWI R0, 0x0010, M skip=M=2", () =>
    assert.deepEqual(asm2("        AWI R0, 0x0010, M"), [0x582f, 0x0010]));
});

describe("MN1613 命令: SWR（ワード間接減算）", () => {
  test("SWR R0, (R1)      op5(11,7,0,0x00)", () =>
    assert.equal(asm1("        SWR R0, (R1)"), 0x5f00));
  test("SWR R0, (R2)      ii=1", () =>
    assert.equal(asm1("        SWR R0, (R2)"), 0x5f01));
});

describe("MN1613 命令: SWI（ワード即値減算）", () => {
  test("SWI R0, 0x0010    word1=0x5807", () =>
    assert.deepEqual(asm2("        SWI R0, 0x0010"), [0x5807, 0x0010]));
  test("SWI R1, 0x0020    word1=0x5907", () =>
    assert.deepEqual(asm2("        SWI R1, 0x0020"), [0x5907, 0x0020]));
});

// CWR/CWI/CBR/CBI

describe("MN1613 命令: CWR / CWI / CBR / CBI（比較系）", () => {
  // CWR: op5(10,7,0,0x08|ii)
  test("CWR R0, (R1)  op5(10,7,0,0x08)", () =>
    assert.equal(asm1("        CWR R0, (R1)"), 0x5708));
  test("CWR R0, (R2)  ii=1", () =>
    assert.equal(asm1("        CWR R0, (R2)"), 0x5709));
  // CWI: op5(10,ddd,skip,0x0F) | IM16
  test("CWI R0, 0x00FF word1=0x500F", () =>
    assert.deepEqual(asm2("        CWI R0, 0x00FF"), [0x500f, 0x00ff]));
  // CBR: op5(10,7,0,ii)
  test("CBR R0, (R1)  op5(10,7,0,0x00)", () =>
    assert.equal(asm1("        CBR R0, (R1)"), 0x5700));
  // CBI: op5(10,ddd,skip,0x07) | IM16
  test("CBI R0, 0x00FF word1=0x5007", () =>
    assert.deepEqual(asm2("        CBI R0, 0x00FF"), [0x5007, 0x00ff]));
});

// ─── 拡張演算命令 ─────────────────────────────────────────────────────────────
//
// NEG: 00011 111 kkkk cddd  =  0x1F00 | (skip<<4) | (c<<3) | rd
// AD:  01001 111 kkkk c1ii  =  op5(9,7,skip,(c<<3)|0x04|ii)
// SD:  01000 111 kkkk c1ii

describe("MN1613 命令: NEG（2の補数）", () => {
  test("NEG R0           c=1(no carry), skip=0", () =>
    assert.equal(asm1("        NEG R0"), 0x1f08));
  test("NEG R1           rd=R1=1", () =>
    assert.equal(asm1("        NEG R1"), 0x1f09));
  test("NEG R0, C        c=0(with carry)", () =>
    assert.equal(asm1("        NEG R0, C"), 0x1f00));
  test("NEG R0, Z        skip=Z=4, c=1", () =>
    assert.equal(asm1("        NEG R0, Z"), 0x1f48));
  test("NEG R0, C, Z     c=0, skip=Z", () =>
    assert.equal(asm1("        NEG R0, C, Z"), 0x1f40));
});

describe("MN1613 命令: AD（32bit加算）", () => {
  // c=1 default: tail=(1<<3)|0x04|ii = 0x0C|ii
  test("AD DR0, (R1)     c=1, ii=0: tail=0x0C", () =>
    assert.equal(asm1("        AD DR0, (R1)"), 0x4f0c));
  test("AD DR0, (R2)     ii=1: tail=0x0D", () =>
    assert.equal(asm1("        AD DR0, (R2)"), 0x4f0d));
  test("AD DR0, (R1), C  c=0: tail=0x04", () =>
    assert.equal(asm1("        AD DR0, (R1), C"), 0x4f04));
  test("AD DR0, (R1), Z  c=1, skip=Z=4", () =>
    assert.equal(asm1("        AD DR0, (R1), Z"), 0x4f4c));
  test("AD DR0, (R1), C, Z c=0, skip=Z", () =>
    assert.equal(asm1("        AD DR0, (R1), C, Z"), 0x4f44));
});

describe("MN1613 命令: SD（32bit減算）", () => {
  // op5(8,7,skip,(c<<3)|0x04|ii)
  test("SD DR0, (R1)     c=1: tail=0x0C", () =>
    assert.equal(asm1("        SD DR0, (R1)"), 0x470c));
  test("SD DR0, (R1), C  c=0: tail=0x04", () =>
    assert.equal(asm1("        SD DR0, (R1), C"), 0x4704));
});

describe("MN1613 命令: M / D（乗除算）", () => {
  // M: op5(15,7,skip,0x0C|ii)
  test("M DR0, (R1)      op5(15,7,0,0x0C)", () =>
    assert.equal(asm1("        M DR0, (R1)"), 0x7f0c));
  test("M DR0, (R2)      ii=1", () =>
    assert.equal(asm1("        M DR0, (R2)"), 0x7f0d));
  // D: op5(14,7,skip,0x0C|ii)
  test("D DR0, (R1)      op5(14,7,0,0x0C)", () =>
    assert.equal(asm1("        D DR0, (R1)"), 0x770c));
  test("D DR0, (R2)      ii=1", () =>
    assert.equal(asm1("        D DR0, (R2)"), 0x770d));
});

describe("MN1613 命令: DAA / DAS（BCD加減算）", () => {
  // DAA: op5(11,7,skip,(c<<3)|0x04|ii)  c=1 default
  test("DAA R0, (R1)     c=1: tail=0x0C", () =>
    assert.equal(asm1("        DAA R0, (R1)"), 0x5f0c));
  test("DAA R0, (R1), C  c=0: tail=0x04", () =>
    assert.equal(asm1("        DAA R0, (R1), C"), 0x5f04));
  // DAS: op5(10,7,skip,(c<<3)|0x04|ii)
  test("DAS R0, (R1)     c=1: tail=0x0C", () =>
    assert.equal(asm1("        DAS R0, (R1)"), 0x570c));
  test("DAS R0, (R1), C  c=0: tail=0x04", () =>
    assert.equal(asm1("        DAS R0, (R1), C"), 0x5704));
});

describe("MN1613 命令: LADR / LADI（BCD補正値ロード）", () => {
  // LADR: op5(13,7,0,ii)
  test("LADR R0, (R1)    op5(13,7,0,0x00)", () =>
    assert.equal(asm1("        LADR R0, (R1)"), 0x6f00));
  test("LADR R0, (R2)    ii=1", () =>
    assert.equal(asm1("        LADR R0, (R2)"), 0x6f01));
  // LADI: op5(13,ddd,skip,0x07) | IM16
  test("LADI R0, 0x1234  word1=0x6807", () =>
    assert.deepEqual(asm2("        LADI R0, 0x1234"), [0x6807, 0x1234]));
  test("LADI R1, 0x5678  word1=0x6907", () =>
    assert.deepEqual(asm2("        LADI R1, 0x5678"), [0x6907, 0x5678]));
});

// ─── 論理演算（レジスタ間接・即値） ──────────────────────────────────────────
//
// ANDR: op5(13,7,skip,0x08|ii)   ANDI: op5(13,ddd,skip,0x0F)|IM16
// ORR:  op5(12,7,skip,0x08|ii)   ORI:  op5(12,ddd,skip,0x0F)|IM16
// EORR: op5(12,7,skip,ii)        EORI: op5(12,ddd,skip,0x07)|IM16

describe("MN1613 命令: ANDR / ANDI（AND系）", () => {
  test("ANDR R0, (R1)     op5(13,7,0,0x08)", () =>
    assert.equal(asm1("        ANDR R0, (R1)"), 0x6f08));
  test("ANDR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        ANDR R0, (R2)"), 0x6f09));
  test("ANDR R0, (R1), Z  skip=Z", () =>
    assert.equal(asm1("        ANDR R0, (R1), Z"), 0x6f48));
  test("ANDI R0, 0xF0F0   word1=0x680F", () =>
    assert.deepEqual(asm2("        ANDI R0, 0xF0F0"), [0x680f, 0xf0f0]));
  test("ANDI R1, 0xF0F0   word1=0x690F", () =>
    assert.deepEqual(asm2("        ANDI R1, 0xF0F0"), [0x690f, 0xf0f0]));
});

describe("MN1613 命令: ORR / ORI（OR系）", () => {
  test("ORR R0, (R1)      op5(12,7,0,0x08)", () =>
    assert.equal(asm1("        ORR R0, (R1)"), 0x6708));
  test("ORR R0, (R2)      ii=1", () =>
    assert.equal(asm1("        ORR R0, (R2)"), 0x6709));
  test("ORI R0, 0x0F0F    word1=0x600F", () =>
    assert.deepEqual(asm2("        ORI R0, 0x0F0F"), [0x600f, 0x0f0f]));
  test("ORI R1, 0x0F0F    word1=0x610F", () =>
    assert.deepEqual(asm2("        ORI R1, 0x0F0F"), [0x610f, 0x0f0f]));
});

describe("MN1613 命令: EORR / EORI（EOR系）", () => {
  test("EORR R0, (R1)     op5(12,7,0,0x00)", () =>
    assert.equal(asm1("        EORR R0, (R1)"), 0x6700));
  test("EORR R0, (R2)     ii=1", () =>
    assert.equal(asm1("        EORR R0, (R2)"), 0x6701));
  test("EORI R0, 0x5555   word1=0x6007", () =>
    assert.deepEqual(asm2("        EORI R0, 0x5555"), [0x6007, 0x5555]));
  test("EORI R1, 0xAAAA   word1=0x6107", () =>
    assert.deepEqual(asm2("        EORI R1, 0xAAAA"), [0x6107, 0xaaaa]));
});

// ─── 浮動小数点演算命令 ───────────────────────────────────────────────────────
//
// FA:  op5(13,7,skip,0x0C|ii)   FS:  op5(13,7,skip,0x04|ii)
// FM:  op5(12,7,skip,0x0C|ii)   FD:  op5(12,7,skip,0x04|ii)
// FIX: 0x1F00|(skip<<4)|0x04    FLT: 0x1F00|(skip<<4)|0x0C

describe("MN1613 命令: FA / FS / FM / FD（浮動小数点四則演算）", () => {
  test("FA  DR0, (R1)  op5(13,7,0,0x0C)", () =>
    assert.equal(asm1("        FA DR0, (R1)"), 0x6f0c));
  test("FA  DR0, (R2)  ii=1", () =>
    assert.equal(asm1("        FA DR0, (R2)"), 0x6f0d));
  test("FA  DR0, (R1), Z skip=Z=4", () =>
    assert.equal(asm1("        FA DR0, (R1), Z"), 0x6f4c));
  test("FS  DR0, (R1)  op5(13,7,0,0x04)", () =>
    assert.equal(asm1("        FS DR0, (R1)"), 0x6f04));
  test("FM  DR0, (R1)  op5(12,7,0,0x0C)", () =>
    assert.equal(asm1("        FM DR0, (R1)"), 0x670c));
  test("FD  DR0, (R1)  op5(12,7,0,0x04)", () =>
    assert.equal(asm1("        FD DR0, (R1)"), 0x6704));
});

describe("MN1613 命令: FIX / FLT（整数⇔浮動小数点変換）", () => {
  test("FIX R0, DR0         0x1F04", () =>
    assert.equal(asm1("        FIX R0, DR0"), 0x1f04));
  test("FIX R0, DR0, Z      skip=Z=4", () =>
    assert.equal(asm1("        FIX R0, DR0, Z"), 0x1f44));
  test("FLT DR0, R0         0x1F0C", () =>
    assert.equal(asm1("        FLT DR0, R0"), 0x1f0c));
  test("FLT DR0, R0, Z      skip=Z=4", () =>
    assert.equal(asm1("        FLT DR0, R0, Z"), 0x1f4c));
});

// ─── 分岐命令（2語含む） ──────────────────────────────────────────────────────
//
// BD:   0x2607 | AD16    BL:   0x270F | AD16
// BR:   0x2700 | 0x04 | ii
// BALD: 0x2617 | AD16   BALL: 0x271F | AD16
// BALR: 0x2700 | 0x14 | ii
// RETL: 0x3F07

describe("MN1613 命令: BD / BL / BR（分岐）", () => {
  test("BD 0x0100    word1=0x2607, word2=0x0100", () =>
    assert.deepEqual(asm2("        BD 0x0100"), [0x2607, 0x0100]));
  test("BL 0x0200    word1=0x270F, word2=0x0200", () =>
    assert.deepEqual(asm2("        BL 0x0200"), [0x270f, 0x0200]));
  test("BL (0x0200)  公式 (Exp) 書式", () =>
    assert.deepEqual(asm2("        BL (0x0200)"), [0x270f, 0x0200]));
  test("BL @0x0200   sdas風 間接拡張", () =>
    assert.deepEqual(asm2("        BL @0x0200"), [0x270f, 0x0200]));
  test("BR (R1)      0x2704 (ii=R1=0)", () =>
    assert.equal(asm1("        BR (R1)"), 0x2704));
  test("BR @(R1)     sdas風 2重間接", () =>
    assert.equal(asm1("        BR @(R1)"), 0x2704));
  test("BR (R2)      0x2705 (ii=R2=1)", () =>
    assert.equal(asm1("        BR (R2)"), 0x2705));
  test("BR (R3)      0x2706 (ii=R3=2)", () =>
    assert.equal(asm1("        BR (R3)"), 0x2706));
  test("BR (R4)      0x2707 (ii=R4=3)", () =>
    assert.equal(asm1("        BR (R4)"), 0x2707));
});

describe("MN1613 命令: BALD / BALL / BALR（リンク付き分岐）", () => {
  test("BALD 0x0300   word1=0x2617, word2=0x0300", () =>
    assert.deepEqual(asm2("        BALD 0x0300"), [0x2617, 0x0300]));
  test("BALL 0x0400   word1=0x271F, word2=0x0400", () =>
    assert.deepEqual(asm2("        BALL 0x0400"), [0x271f, 0x0400]));
  test("BALL (0x0400) 公式 (Exp) 書式", () =>
    assert.deepEqual(asm2("        BALL (0x0400)"), [0x271f, 0x0400]));
  test("BALL @0x0400  sdas風 間接拡張", () =>
    assert.deepEqual(asm2("        BALL @0x0400"), [0x271f, 0x0400]));
  test("BALR (R1)     0x2714 (ii=0)", () =>
    assert.equal(asm1("        BALR (R1)"), 0x2714));
  test("BALR @(R2)    sdas風 2重間接", () =>
    assert.equal(asm1("        BALR @(R2)"), 0x2715));
  test("BALR (R2)     0x2715 (ii=1)", () =>
    assert.equal(asm1("        BALR (R2)"), 0x2715));
});

describe("MN1613 命令: RETL（セグメント間リターン）", () => {
  test("RETL → 0x3F07", () => assert.equal(asm1("        RETL"), 0x3f07));
});

// ─── ビット操作命令（MN1613新設） ────────────────────────────────────────────
//
// TSET: 0x1700|(skip<<4)|0x08|rs | AD16
// TRST: 0x1700|(skip<<4)|rs      | AD16
// SRBT: 0x3F70 | rs
// DEBP: 0x3FF0 | rd

describe("MN1613 命令: TSET / TRST（アトミックビット操作）", () => {
  test("TSET R0, 0x0100     rs=R0=0: word1=0x1708", () =>
    assert.deepEqual(asm2("        TSET R0, 0x0100"), [0x1708, 0x0100]));
  test("TSET R1, 0x0100     rs=R1=1: word1=0x1709", () =>
    assert.deepEqual(asm2("        TSET R1, 0x0100"), [0x1709, 0x0100]));
  test("TSET R0, 0x0100, Z  skip=Z=4: word1=0x1748", () =>
    assert.deepEqual(asm2("        TSET R0, 0x0100, Z"), [0x1748, 0x0100]));
  test("TRST R0, 0x0200     rs=R0=0: word1=0x1700", () =>
    assert.deepEqual(asm2("        TRST R0, 0x0200"), [0x1700, 0x0200]));
  test("TRST R1, 0x0200     rs=R1=1: word1=0x1701", () =>
    assert.deepEqual(asm2("        TRST R1, 0x0200"), [0x1701, 0x0200]));
});

describe("MN1613 命令: SRBT / DEBP（ビット位置検索・展開）", () => {
  test("SRBT R0, R0     rs=R0=0: 0x3F70", () =>
    assert.equal(asm1("        SRBT R0, R0"), 0x3f70));
  test("SRBT R0, R1     rs=R1=1: 0x3F71", () =>
    assert.equal(asm1("        SRBT R0, R1"), 0x3f71));
  test("SRBT R0, SP     rs=SP=5: 0x3F75", () =>
    assert.equal(asm1("        SRBT R0, SP"), 0x3f75));
  test("DEBP R0, R0     rd=R0=0: 0x3FF0", () =>
    assert.equal(asm1("        DEBP R0, R0"), 0x3ff0));
  test("DEBP R1, R0     rd=R1=1: 0x3FF1", () =>
    assert.equal(asm1("        DEBP R1, R0"), 0x3ff1));
});

// ─── 特殊命令 ─────────────────────────────────────────────────────────────────
//
// BLK: 0x3F17
// RDR: 0x2000 | (r<<8) | 0x14 | ii
// WTR: 0x2000 | (r<<8) | 0x10 | ii

describe("MN1613 命令: BLK（ブロック転送）", () => {
  test("BLK → 0x3F17", () => assert.equal(asm1("        BLK"), 0x3f17));
});

describe("MN1613 命令: RDR / WTR（I/Oレジスタ間接）", () => {
  test("RDR R0, (R1)    r=R0=0, ii=0: 0x2014", () =>
    assert.equal(asm1("        RDR R0, (R1)"), 0x2014));
  test("RDR R0, (R2)    ii=1: 0x2015", () =>
    assert.equal(asm1("        RDR R0, (R2)"), 0x2015));
  test("RDR R1, (R1)    r=R1=1: 0x2114", () =>
    assert.equal(asm1("        RDR R1, (R1)"), 0x2114));
  test("WTR R0, (R1)    0x2010", () =>
    assert.equal(asm1("        WTR R0, (R1)"), 0x2010));
  test("WTR R0, (R2)    ii=1: 0x2011", () =>
    assert.equal(asm1("        WTR R0, (R2)"), 0x2011));
  test("WTR R1, (R1)    r=R1=1: 0x2110", () =>
    assert.equal(asm1("        WTR R1, (R1)"), 0x2110));
});

// ─── レジスタ転送命令（2語） ──────────────────────────────────────────────────
//
// LB:   0x0F00|(bbb<<4)|0x07      | AD16
// LS:   0x0F00|(ppp<<4)|0x0F      | AD16
// STB:  0x0F00|0x80|(bbb<<4)|0x07 | AD16   (CSBR書き込み禁止: bbb=0 不可)
// STS:  0x0F00|0x80|(ppp<<4)|0x0F | AD16
// CPYB: 0x0F00|0x80|(bbb<<4)|rd
// CPYS: 0x0F00|0x80|(ppp<<4)|0x08|rd
// CPYH: 0x3F00|0x80|(hhh<<4)|rd
// SETB: 0x0F00|(bbb<<4)|rs        (CSBR書き込み禁止)
// SETS: 0x0F00|(ppp<<4)|0x08|rs
// SETH: 0x3F00|(hhh<<4)|rs

describe("MN1613 命令: LB / STB（ベースレジスタ転送）", () => {
  // LB: read (CSBR=0 も可)
  test("LB CSBR, 0x0100   bbb=0: word1=0x0F07", () =>
    assert.deepEqual(asm2("        LB CSBR, 0x0100"), [0x0f07, 0x0100]));
  test("LB SSBR, 0x0100   bbb=1: word1=0x0F17", () =>
    assert.deepEqual(asm2("        LB SSBR, 0x0100"), [0x0f17, 0x0100]));
  test("LB TSR0, 0x0200   bbb=2: word1=0x0F27", () =>
    assert.deepEqual(asm2("        LB TSR0, 0x0200"), [0x0f27, 0x0200]));
  test("LB TSR1, 0x0300   bbb=3: word1=0x0F37", () =>
    assert.deepEqual(asm2("        LB TSR1, 0x0300"), [0x0f37, 0x0300]));
  test("LB OSR0, 0x0400   bbb=4: word1=0x0F47", () =>
    assert.deepEqual(asm2("        LB OSR0, 0x0400"), [0x0f47, 0x0400]));
  test("LB OSR3, 0x0500   bbb=7: word1=0x0F77", () =>
    assert.deepEqual(asm2("        LB OSR3, 0x0500"), [0x0f77, 0x0500]));
  // STB: write (CSBR=0 は禁止)
  test("STB SSBR, 0x0100  bbb=1: word1=0x0F97", () =>
    assert.deepEqual(asm2("        STB SSBR, 0x0100"), [0x0f97, 0x0100]));
  test("STB TSR0, 0x0200  bbb=2: word1=0x0FA7", () =>
    assert.deepEqual(asm2("        STB TSR0, 0x0200"), [0x0fa7, 0x0200]));
  test("STB OSR0, 0x0300  bbb=4: word1=0x0FC7", () =>
    assert.deepEqual(asm2("        STB OSR0, 0x0300"), [0x0fc7, 0x0300]));
});

describe("MN1613 命令: LS / STS（特殊レジスタ転送）", () => {
  test("LS SBRB, 0x0100   ppp=0: word1=0x0F0F", () =>
    assert.deepEqual(asm2("        LS SBRB, 0x0100"), [0x0f0f, 0x0100]));
  test("LS ICB, 0x0200    ppp=1: word1=0x0F1F", () =>
    assert.deepEqual(asm2("        LS ICB, 0x0200"), [0x0f1f, 0x0200]));
  test("LS NPP, 0x0300    ppp=2: word1=0x0F2F", () =>
    assert.deepEqual(asm2("        LS NPP, 0x0300"), [0x0f2f, 0x0300]));
  test("STS SBRB, 0x0100  ppp=0: word1=0x0F8F", () =>
    assert.deepEqual(asm2("        STS SBRB, 0x0100"), [0x0f8f, 0x0100]));
  test("STS NPP, 0x0200   ppp=2: word1=0x0FAF", () =>
    assert.deepEqual(asm2("        STS NPP, 0x0200"), [0x0faf, 0x0200]));
});

describe("MN1613 命令: CPYB / SETB（ベースレジスタ⇔汎用レジスタ）", () => {
  test("CPYB R0, CSBR   rd=0, bbb=0: 0x0F80", () =>
    assert.equal(asm1("        CPYB R0, CSBR"), 0x0f80));
  test("CPYB R0, SSBR   bbb=1: 0x0F90", () =>
    assert.equal(asm1("        CPYB R0, SSBR"), 0x0f90));
  test("CPYB R1, TSR0   rd=1, bbb=2: 0x0FA1", () =>
    assert.equal(asm1("        CPYB R1, TSR0"), 0x0fa1));
  test("CPYB R0, OSR0   bbb=4: 0x0FC0", () =>
    assert.equal(asm1("        CPYB R0, OSR0"), 0x0fc0));
  // SETB: write (CSBR 禁止)
  test("SETB R0, SSBR   rs=0, bbb=1: 0x0F10", () =>
    assert.equal(asm1("        SETB R0, SSBR"), 0x0f10));
  test("SETB R1, TSR0   rs=1, bbb=2: 0x0F21", () =>
    assert.equal(asm1("        SETB R1, TSR0"), 0x0f21));
  test("SETB R0, OSR0   bbb=4: 0x0F40", () =>
    assert.equal(asm1("        SETB R0, OSR0"), 0x0f40));
});

describe("MN1613 命令: CPYS / SETS（特殊レジスタ⇔汎用レジスタ）", () => {
  test("CPYS R0, SBRB   rd=0, ppp=0: 0x0F88", () =>
    assert.equal(asm1("        CPYS R0, SBRB"), 0x0f88));
  test("CPYS R0, NPP    ppp=2: 0x0FA8", () =>
    assert.equal(asm1("        CPYS R0, NPP"), 0x0fa8));
  test("CPYS R1, ICB    rd=1, ppp=1: 0x0F99", () =>
    assert.equal(asm1("        CPYS R1, ICB"), 0x0f99));
  test("SETS R0, SBRB   rs=0, ppp=0: 0x0F08", () =>
    assert.equal(asm1("        SETS R0, SBRB"), 0x0f08));
  test("SETS R0, NPP    ppp=2: 0x0F28", () =>
    assert.equal(asm1("        SETS R0, NPP"), 0x0f28));
  test("SETS R1, ICB    rs=1, ppp=1: 0x0F19", () =>
    assert.equal(asm1("        SETS R1, ICB"), 0x0f19));
});

describe("MN1613 命令: CPYH / SETH（HW制御レジスタ⇔汎用レジスタ）", () => {
  test("CPYH R0, TCR    rd=0, hhh=0: 0x3F80", () =>
    assert.equal(asm1("        CPYH R0, TCR"), 0x3f80));
  test("CPYH R0, TIR    hhh=1: 0x3F90", () =>
    assert.equal(asm1("        CPYH R0, TIR"), 0x3f90));
  test("CPYH R0, TSR    hhh=2: 0x3FA0", () =>
    assert.equal(asm1("        CPYH R0, TSR"), 0x3fa0));
  test("CPYH R0, SCR    hhh=3: 0x3FB0", () =>
    assert.equal(asm1("        CPYH R0, SCR"), 0x3fb0));
  test("CPYH R1, SSR    rd=1, hhh=4: 0x3FC1", () =>
    assert.equal(asm1("        CPYH R1, SSR"), 0x3fc1));
  test("CPYH R0, IISR   hhh=6: 0x3FE0", () =>
    assert.equal(asm1("        CPYH R0, IISR"), 0x3fe0));
  test("SETH R0, TCR    rs=0, hhh=0: 0x3F00", () =>
    assert.equal(asm1("        SETH R0, TCR"), 0x3f00));
  test("SETH R0, TIR    hhh=1: 0x3F10", () =>
    assert.equal(asm1("        SETH R0, TIR"), 0x3f10));
  test("SETH R0, SCR    hhh=3: 0x3F30", () =>
    assert.equal(asm1("        SETH R0, SCR"), 0x3f30));
  test("SETH R1, IISR   rs=1, hhh=6: 0x3F61", () =>
    assert.equal(asm1("        SETH R1, IISR"), 0x3f61));
});

// ─── 2語命令のPC計算検証 ─────────────────────────────────────────────────────

describe("MN1613 2語命令: pass1 PC計算の正確性", () => {
  test("2語命令は2ワード分PCを消費フラベルアドレスが正しい", () => {
    // LD R0, 0   : addr 0 (word1), addr 1 (word2=AD16)  → 2語
    // MVWI R1, 0 : addr 2 (word1), addr 3 (word2=IM16)  → 2語
    // TARGET:    : addr 4
    const result = assemble(
      "        .org 0\n        LD R0, 0\n        MVWI R1, 0\nTARGET: H\n",
    );
    assert.equal(
      result.symbols.get("TARGET"),
      4,
      "LD(2語)+MVWI(2語)=4ワード後にTARGETがあるはず",
    );
    assert.equal(result.words.length, 5, "LD(2)+MVWI(2)+H(1)の計5ワード指令語");
    assert.deepEqual(
      result.words.map((w) => w.address),
      [0, 1, 2, 3, 4],
    );
  });

  test("TSET(2語)後のラベルアドレスが2になる", () => {
    // TSET R0, 0 : addr 0 (word1), addr 1 (word2)  → 2語
    // AFTER:     : addr 2
    const result = assemble("        .org 0\n        TSET R0, 0\nAFTER: H\n");
    assert.equal(result.symbols.get("AFTER"), 2);
  });

  test("1語命令と混在してもラベルが正しい", () => {
    // H          : addr 0  (1語)
    // AWI R0, 0  : addr 1, addr 2  (2語)
    // H          : addr 3  (1語)
    // AFTER:     : addr 4
    const result = assemble(
      "        .org 0\n        H\n        AWI R0, 0\n        H\nAFTER: H\n",
    );
    assert.equal(result.symbols.get("AFTER"), 4);
  });
});
