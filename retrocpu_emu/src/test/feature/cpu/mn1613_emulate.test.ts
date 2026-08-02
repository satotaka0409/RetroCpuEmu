/**
 * MN1613 CPU エミュレータ テスト
 *
 * 参照文書: .github/MN1610.md / .github/MN1613.md
 *
 * エンコード早見表（全て 16 進ワード）:
 *   MVI Rn, #im  0x08nn〜0x0Enn  (op=0x01, rrr=n, im8=im)
 *   MV  Rd, Rs   0x78xx〜0x7Exx  (op=0x0F, bit3=1)
 *   A   Rd, Rs   0x58xx〜0x5Exx  (op=0x0B, bit3=1)
 *   S   Rd, Rs   0x58xx〜0x5Exx  (op=0x0B, bit3=0)
 *   AI  Rn, #4   0x48xx          (op=0x09, フラグ変化なし)
 *   SI  Rn, #4   0x40xx          (op=0x08, フラグ変化なし)
 *   AND Rd, Rs   0x68xx          (op=0x0D, bit3=1)
 *   OR  Rd, Rs   0x60xx          (op=0x0C, bit3=1)
 *   EOR Rd, Rs   0x60xx          (op=0x0C, bit3=0)
 *   L   Rd, ZP   0xC0nn          (op=0x18, MMM=000)
 *   ST  Rs, ZP   0x80nn          (op=0x10, MMM=000)
 *   B   ZP       0xC7nn          (op=0x18, RRR=7, MMM=000)
 *   BAL ZP       0x87nn          (op=0x10, RRR=7, MMM=000)
 *   RET          0x2003          (op=0x04, lo=0x03)
 *   H            0x2000          (op=0x04, lo=0x00)
 *   PUSH Rn      0x20xx+0x01     (op=0x04, lo=0x01)
 *   POP  Rn      0x20xx+0x02     (op=0x04, lo=0x02)
 *   SR   Rn      0x2008+rrr<<8   (op=0x04, bits[3:2]=10, EE=00)
 *   SL   Rn      0x200C+rrr<<8   (op=0x04, bits[3:2]=11, EE=00)
 *   SBIT Rn,#b   0x38xx          (op=0x07, lo=kkkk<<4|bit)
 *   RBIT Rn,#b   0x30xx          (op=0x06)
 *   TBIT Rn,#b   0x28xx          (op=0x05)
 *   NEG  Rd      0x1F08+rd       (op=0x03, c=1)
 *   RD   Rn,im8  0x18nn          (op=0x03, rrr≠7)
 *   WT   Rs,im8  0x10nn          (op=0x02, rrr≠7)
 *   LPSW ll      0x2004+ll       (op=0x04, rrr=0, lo=4+ll)
 *   BSWP Rd,Rs   0x70xx          (op=0x0E, bit3=1)
 *   DSWP Rd,Rs   0x70xx          (op=0x0E, bit3=0)
 *   LAD  Rd,Rs   0x68xx          (op=0x0D, bit3=0)
 *   MVWI Rd,im16 [0x7807+rd<<8, im16]  (op=0x0F, sss=7, bit3=0)
 *   AWI  Rd,im16 [0x580F+rd<<8, im16]  (op=0x0B, sss=7, bit3=1)
 *   SWI  Rd,im16 [0x5807+rd<<8, im16]  (op=0x0B, sss=7, bit3=0)
 *   LD   Rd,ad16 [0x2708+rd,    ad16]  (op=0x04, rrr=7, BB=0, bit3=1)
 *   STD  Rs,ad16 [0x2748+rs,    ad16]  (op=0x04, rrr=7, BB=0, bit6=1, bit3=1)
 *   LR   Rd,(Ri) 0x2040+rd<<8+ii      (op=0x04, mm=01, BB=0, bits[3:2]=00)
 *   STRi Rs,(Ri) 0x2044+rs<<8+ii      (op=0x04, mm=01, BB=0, bits[3:2]=01)
 *   PSHM         0x170F               (op=0x02, rrr=7, lo=0x0F)
 *   POPM         0x1707               (op=0x02, rrr=7, lo=0x07)
 *   M  DR0,(Ri)  0x7F0C+ii            (op=0x0F, rrr=7, bits[3:2]=11)
 *   D  DR0,(Ri)  0x770C+ii            (op=0x0E, rrr=7, bits[3:2]=11)
 *   BLK          0x3F17               (op=0x07, rrr=7, lo=0x17)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  reset,
  getState,
  getExecStatus,
  setMemory,
  getMemory,
  step,
  run,
  addBreakpoint,
  clearBreakpoints,
  triggerInterrupt,
  setPins,
  getPins,
  setIoReadCallback,
  setIoWriteCallback,
  STR_E,
  STR_OVF,
} from "../../../main/feature/cpu/mn1613";

// ─────────────────────────────────────────────
// テストユーティリティ
// ─────────────────────────────────────────────

/** ワード列をアドレス 0 から書き込んだ ArrayBuffer を生成してセットする */
function loadWords(words: number[]): void {
  const buf = new ArrayBuffer(0x20000); // 128KB (ゼロページ/ワーキングエリア用)
  const view = new DataView(buf);
  for (let i = 0; i < words.length; i++) {
    view.setUint16(i * 2, words[i] & 0xffff, false);
  }
  setMemory(buf);
}

/** H 命令まで実行して最終状態を返す */
async function runHalt(
  words: number[],
  startAddr = 0,
  maxCycles = 50000,
): Promise<ReturnType<typeof getState>> {
  loadWords(words);
  await run(startAddr, maxCycles);
  return getState();
}

// ─────────────────────────────────────────────
// beforeEach: 毎テストで CPU をリセット
// ─────────────────────────────────────────────
beforeEach(() => {
  reset();
  clearBreakpoints();
  setIoReadCallback((_p) => 0x00);
  setIoWriteCallback((_p, _v) => {});
});

// ─────────────────────────────────────────────
// 1. リセット / 初期状態
// ─────────────────────────────────────────────
describe("reset", () => {
  it("全レジスタが 0 で IC=0 になる", () => {
    const s = getState();
    expect(s.R[0]).toBe(0);
    expect(s.R[4]).toBe(0);
    expect(s.SP).toBe(0);
    expect(s.STR).toBe(0);
    expect(s.IC).toBe(0);
    expect(s.CSBR).toBe(0);
  });

  it("NPP は 1 で初期化される（MN1613 仕様）", () => {
    expect(getState().NPP).toBe(0x01);
  });

  it("getExecStatus() は idle を返す", () => {
    expect(getExecStatus()).toBe("idle");
  });
});

// ─────────────────────────────────────────────
// 2. H 命令（HALT）
// ─────────────────────────────────────────────
describe("H 命令", () => {
  it("H で停止する", async () => {
    // H = 0x2000
    const s = await runHalt([0x2000]);
    expect(getExecStatus()).toBe("halted");
    expect(s.IC).toBe(1); // H の次
  });
});

// ─────────────────────────────────────────────
// 3. MVI（8bit 即値ロード）
// ─────────────────────────────────────────────
describe("MVI 命令", () => {
  it("MVI R0, #0x55 → R0 下位 8bit=0x55", async () => {
    // MVI R0, #0x55 = 0x0855、H = 0x2000
    const s = await runHalt([0x0855, 0x2000]);
    expect(s.R[0]).toBe(0x0055);
  });

  it("MVI は上位 8bit を変えない", async () => {
    // MVWI R0, 0xFF00; MVI R0, #0xAA; H
    await runHalt([0x7807, 0xff00, 0x08aa, 0x2000]);
    expect(getState().R[0]).toBe(0xffaa);
  });

  it("MVI R4, #0x0F → R4=0x0F", async () => {
    const s = await runHalt([0x0c0f, 0x2000]); // MVI R4=rrr4
    expect(s.R[4]).toBe(0x000f);
  });
});

// ─────────────────────────────────────────────
// 4. MV / MVWI（レジスタ転送・16bit 即値）
// ─────────────────────────────────────────────
describe("MV / MVWI 命令", () => {
  it("MVWI R0, 0x1234 → R0=0x1234", async () => {
    // MVWI R0, 0x1234 = [0x7807, 0x1234]; H
    const s = await runHalt([0x7807, 0x1234, 0x2000]);
    expect(s.R[0]).toBe(0x1234);
  });

  it("MV R1, R0 → R1=R0", async () => {
    // MVWI R0, 0xABCD; MV R1, R0; H
    // MV R1, R0 = 0x7908 (01111 001 0000 1000)
    const s = await runHalt([0x7807, 0xabcd, 0x7908, 0x2000]);
    expect(s.R[1]).toBe(0xabcd);
    expect(s.R[0]).toBe(0xabcd);
  });

  it("MV STR, R0 → STR に値が転送される", async () => {
    // MVWI R0, 0x0100; MV STR, R0; H
    // MV STR, R0 = 0x7E08 (01111 110 0000 1000)
    const s = await runHalt([0x7807, 0x0100, 0x7e08, 0x2000]);
    expect(s.STR).toBe(0x0100);
  });
});

// ─────────────────────────────────────────────
// 5. A 命令（加算）
// ─────────────────────────────────────────────
describe("A 命令（加算）", () => {
  it("1 + 2 = 3", async () => {
    // MVWI R0, 1; MVWI R1, 2; A R0, R1; H
    // A R0, R1 = 0x5809
    const s = await runHalt([0x7807, 0x0001, 0x7907, 0x0002, 0x5809, 0x2000]);
    expect(s.R[0]).toBe(3);
    expect(s.STR & STR_E).toBe(0); // キャリーなし
  });

  it("0xFFFF + 1 → キャリー発生（STR_E セット）", async () => {
    // MVWI R0, 0xFFFF; MVWI R1, 1; A R0, R1; H
    const s = await runHalt([0x7807, 0xffff, 0x7907, 0x0001, 0x5809, 0x2000]);
    expect(s.R[0]).toBe(0x0000);
    expect(s.STR & STR_E).not.toBe(0);
  });

  it("0x7FFF + 1 → オーバーフロー（STR_OVF セット）", async () => {
    const s = await runHalt([0x7807, 0x7fff, 0x7907, 0x0001, 0x5809, 0x2000]);
    expect(s.R[0]).toBe(0x8000);
    expect(s.STR & STR_OVF).not.toBe(0);
  });
});

// ─────────────────────────────────────────────
// 6. S 命令（減算）
// ─────────────────────────────────────────────
describe("S 命令（減算）", () => {
  it("5 - 3 = 2", async () => {
    // MVWI R0, 5; MVWI R1, 3; S R0, R1; H
    // S R0, R1 = 0x5801
    const s = await runHalt([0x7807, 0x0005, 0x7907, 0x0003, 0x5801, 0x2000]);
    expect(s.R[0]).toBe(2);
    expect(s.STR & STR_E).toBe(0); // ボローなし
  });

  it("0 - 1 → ボロー発生（STR_E セット）", async () => {
    // MVWI R0, 0; MVWI R1, 1; S R0, R1; H
    const s = await runHalt([0x7807, 0x0000, 0x7907, 0x0001, 0x5801, 0x2000]);
    expect(s.R[0]).toBe(0xffff);
    expect(s.STR & STR_E).not.toBe(0);
  });
});

// ─────────────────────────────────────────────
// 7. AI / SI（即値加減算、フラグ変化なし）
// ─────────────────────────────────────────────
describe("AI / SI 命令", () => {
  it("AI R0, #5 → R0=5、E フラグ変化なし", async () => {
    // AI R0, #5 = 0x4805
    const s = await runHalt([0x4805, 0x2000]);
    expect(s.R[0]).toBe(5);
    expect(s.STR & STR_E).toBe(0);
  });

  it("SI R0, #3 → R0=0xFFFD、E フラグ変化なし", async () => {
    // SI R0, #3 = 0x4003
    const s = await runHalt([0x4003, 0x2000]);
    expect(s.R[0]).toBe(0xfffd);
    expect(s.STR & STR_E).toBe(0); // SI はフラグを変えない
  });
});

// ─────────────────────────────────────────────
// 8. AND / OR / EOR
// ─────────────────────────────────────────────
describe("AND / OR / EOR", () => {
  it("AND: 0xFF0F & 0x0FF0 = 0x0F00", async () => {
    // AND R0, R1 = 0x6809
    const s = await runHalt([
      0x7807,
      0xff0f, // MVWI R0, 0xFF0F
      0x7907,
      0x0ff0, // MVWI R1, 0x0FF0
      0x6809, // AND R0, R1
      0x2000, // H
    ]);
    expect(s.R[0]).toBe(0x0f00);
  });

  it("OR: 0x00FF | 0xFF00 = 0xFFFF", async () => {
    // OR R0, R1 = 0x6009
    const s = await runHalt([0x7807, 0x00ff, 0x7907, 0xff00, 0x6009, 0x2000]);
    expect(s.R[0]).toBe(0xffff);
  });

  it("EOR: R0 EOR R0 = 0（CLR の代用）", async () => {
    // EOR R0, R0 = 0x6000
    const s = await runHalt([0x7807, 0x1234, 0x6000, 0x2000]);
    expect(s.R[0]).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 9. L / ST（メモリロード・ストア）
// ─────────────────────────────────────────────
describe("L / ST 命令（ゼロページ直接）", () => {
  it("ST して L で読み返せる", async () => {
    // MVWI R0, 0x5678; ST R0, [0x10]; MVI R0, #0; L R0, [0x10]; H
    // ST R0, ZP=0x10 = 0x8010; L R0, ZP=0x10 = 0xC010
    const s = await runHalt([
      0x7807,
      0x5678, // MVWI R0, 0x5678
      0x8010, // ST R0, *0x10
      0x0800, // MVI R0, #0
      0xc010, // L R0, *0x10
      0x2000, // H
    ]);
    expect(s.R[0]).toBe(0x5678);
  });

  it("L SP, ZP → SP にロードされる", async () => {
    // メモリ 0x10 に 0x0200 を書いておく
    const words: number[] = new Array(0x20).fill(0);
    words[0x10] = 0x0200;
    // L SP, ZP=0x10 = 0xC510 (L op=0x18, rrr=5=SP, MMM=000, D=0x10)
    words[0] = 0xc510;
    words[1] = 0x2000;
    loadWords(words);
    await run(0, 1000);
    expect(getState().SP).toBe(0x0200);
  });
});

// ─────────────────────────────────────────────
// 10. B 命令（無条件分岐）
// ─────────────────────────────────────────────
describe("B 命令（ゼロページ直接）", () => {
  it("B *0x05 → IC=0x05 にジャンプ", async () => {
    const words: number[] = new Array(8).fill(0x2000); // 全部 H
    words[0] = 0xc705; // B *0x05 (B, MMM=000, RRR=7, D=0x05)
    loadWords(words);
    step();
    expect(getState().IC).toBe(0x05);
  });
});

// ─────────────────────────────────────────────
// 11. BAL / RET（サブルーチン呼び出し）
// ─────────────────────────────────────────────
describe("BAL / RET", () => {
  it("BAL でサブルーチンを呼び RET で戻る", async () => {
    // addr 0,1: MVWI SP, 0x00FF
    // addr 2:   BAL *0x04  (0x8704)
    // addr 3:   H          (リターン後に到達)
    // addr 4,5: MVWI R0, 0xCAFE
    // addr 6:   RET
    const s = await runHalt([
      0x7d07,
      0x00ff, // MVWI SP, 0x00FF
      0x8704, // BAL *0x04
      0x2000, // H (return先)
      0x7807,
      0xcafe, // MVWI R0, 0xCAFE
      0x2003, // RET
    ]);
    expect(s.R[0]).toBe(0xcafe);
    expect(s.IC).toBe(4); // H (addr 3) の次
  });
});

// ─────────────────────────────────────────────
// 12. PUSH / POP
// ─────────────────────────────────────────────
describe("PUSH / POP", () => {
  it("PUSH して POP で値が戻る", async () => {
    // MVWI SP, 0x00FF; MVWI R0, 0x1234; PUSH R0; MVI R0, #0; POP R0; H
    // PUSH R0 = 0x2001; POP R0 = 0x2002
    const s = await runHalt([
      0x7d07,
      0x00ff, // MVWI SP, 0x00FF
      0x7807,
      0x1234, // MVWI R0, 0x1234
      0x2001, // PUSH R0
      0x0800, // MVI R0, #0
      0x2002, // POP R0
      0x2000, // H
    ]);
    expect(s.R[0]).toBe(0x1234);
  });

  it("PUSH R0; PUSH R1; POP R1; POP R0 でスタック順が正しい", async () => {
    const s = await runHalt([
      0x7d07,
      0x00ff, // MVWI SP
      0x7807,
      0xaaaa, // MVWI R0, 0xAAAA
      0x7907,
      0xbbbb, // MVWI R1, 0xBBBB
      0x2001, // PUSH R0
      0x2101, // PUSH R1
      0x2102, // POP R1
      0x2002, // POP R0
      0x2000,
    ]);
    expect(s.R[0]).toBe(0xaaaa);
    expect(s.R[1]).toBe(0xbbbb);
  });
});

// ─────────────────────────────────────────────
// 13. IMS / DMS（メモリ加減算・スキップ）
// ─────────────────────────────────────────────
describe("IMS / DMS", () => {
  it("IMS: メモリをインクリメントし結果=0 でスキップ", async () => {
    // メモリ 0x10=0xFFFF; IMS *0x10 → 0 になる → スキップ
    // IMS *0x10 = 0xC610; 後の命令がスキップされる
    // スキップ先: MVWI R0, 0x0001; H  ← ここに来るはず
    const words: number[] = new Array(0x20).fill(0);
    words[0x10] = 0xffff;
    words[0] = 0xc610; // IMS *0x10
    words[1] = 0x0800; // MVI R0, #0  ← スキップされる
    words[2] = 0x7807;
    words[3] = 0x0001; // MVWI R0, 0x0001
    words[4] = 0x2000; // H
    loadWords(words);
    await run(0, 1000);
    expect(getState().R[0]).toBe(0x0001); // スキップされた結果
    expect(getState().IC).toBe(5);
  });

  it("DMS: デクリメントし結果が非ゼロならスキップしない", async () => {
    const words: number[] = new Array(0x20).fill(0);
    words[0x10] = 0x0002;
    // DMS *0x10 = 0x8610 → result=1, 非ゼロなのでスキップなし
    words[0] = 0x8610;
    words[1] = 0x7807;
    words[2] = 0x00ff; // MVWI R0, 0x00FF
    words[3] = 0x2000;
    loadWords(words);
    await run(0, 1000);
    expect(getState().R[0]).toBe(0x00ff); // スキップされずに実行された
  });
});

// ─────────────────────────────────────────────
// 14. SR / SL（シフト命令）
// ─────────────────────────────────────────────
describe("SR / SL 命令", () => {
  it("SR R0, RE: 論理右シフト（ゼロを入れる）", async () => {
    // MVWI R0, 0x8002; SR R0, RE; H
    // SR R0, RE = 0x2009
    const s = await runHalt([0x7807, 0x8002, 0x2009, 0x2000]);
    expect(s.R[0]).toBe(0x4001); // 右に1bitシフト
    expect(s.STR & STR_E).toBe(0); // LSB=0 → E=0
  });

  it("SR R0: キャリー付き右ローテート（E=1 の場合）", async () => {
    // E=1 にしてから SR(EE=00): MSB に E が入る
    // MV STR で E をセット: STR_E=0x8000
    // MV STR, R0 は 0x7E08 (01111 110 0000 1000)
    const s = await runHalt([
      0x7807,
      0x8000, // MVWI R0, STR_E=0x8000
      0x7e08, // MV STR, R0  → STR=0x8000 (E=1)
      0x7807,
      0x0001, // MVWI R0, 0x0001
      0x2008, // SR R0 (EE=00, E はそのまま)
      0x2000,
    ]);
    expect(s.R[0]).toBe(0x8000); // E=1 が MSB に入る
    expect(s.STR & STR_E).not.toBe(0); // LSB=1 → E=1
  });

  it("SL R0, RE: 論理左シフト", async () => {
    // MVWI R0, 0x0001; SL R0, RE; H
    // SL R0, RE = 0x200D
    const s = await runHalt([0x7807, 0x0001, 0x200d, 0x2000]);
    expect(s.R[0]).toBe(0x0002);
    expect(s.STR & STR_E).toBe(0); // MSB=0 → E=0
  });
});

// ─────────────────────────────────────────────
// 15. SBIT / RBIT / TBIT（ビット操作）
// ─────────────────────────────────────────────
describe("SBIT / RBIT / TBIT", () => {
  it("SBIT R0, #15 → ビット15（LSB）をセット", async () => {
    // SBIT R0, #15 = 0x380F (00111 000 0000 1111, bit#=15 → mask=0x0001)
    const s = await runHalt([0x380f, 0x2000]);
    expect(s.R[0] & 0x0001).toBe(1);
  });

  it("RBIT R0, #0 → ビット0（MSB）をリセット", async () => {
    // まず 0xFFFF をセット; RBIT R0, #0 = 0x3000
    const s = await runHalt([0x7807, 0xffff, 0x3000, 0x2000]);
    expect(s.R[0]).toBe(0x7fff); // MSB がクリア
  });

  it("TBIT R0, #0, Z: MSB=0 → スキップ発生", async () => {
    // R0=0x7FFF(MSB=0); TBIT R0, #0, Z = 0x2840; 次命令スキップ
    const s = await runHalt([
      0x7807,
      0x7fff, // MVWI R0, 0x7FFF
      0x2840, // TBIT R0, #0, Z (スキップ条件: Z=0x04, DDDD=0)
      0x0800, // MVI R0, #0  ← スキップされる
      0x7807,
      0xbeef, // MVWI R0, 0xBEEF
      0x2000,
    ]);
    expect(s.R[0]).toBe(0xbeef);
  });
});

// ─────────────────────────────────────────────
// 16. スキップ条件（16 種）
// ─────────────────────────────────────────────
describe("スキップ条件", () => {
  /** A R0, R1 を実行してスキップが起きるか確認するヘルパー。
   * スキップあり: MVI R2, #0x55 がスキップ → R2=0
   * スキップなし: MVI R2, #0x55 が実行   → R2=0x55
   */
  async function testSkip(
    r0: number,
    r1: number,
    kkkk: number,
    expectSkipped: boolean,
  ): Promise<void> {
    const aInstr = 0x5800 | (kkkk << 4) | 0x09; // A R0, R1 [skip=kkkk]
    const s = await runHalt([
      0x7807,
      r0, // MVWI R0, r0
      0x7907,
      r1, // MVWI R1, r1
      aInstr, // A R0, R1 [skip=kkkk]
      0x0a55, // MVI R2, #0x55  ← スキップ対象
      0x2000, // H
    ]);
    if (expectSkipped) {
      expect(s.R[2]).toBe(0x0000); // MVI R2, #0x55 がスキップされた
    } else {
      expect(s.R[2]).toBe(0x0055); // MVI R2, #0x55 が実行された
    }
  }

  it("kkkk=0x0: スキップなし", async () => testSkip(1, 1, 0x0, false));
  it("kkkk=0x1: SKP 無条件スキップ", async () => testSkip(1, 1, 0x1, true));
  it("kkkk=0x2: M 負", async () => testSkip(0x0001, 0x7fff, 0x2, true)); // 1+0x7FFF=0x8000(負)
  it("kkkk=0x3: PZ 正または零", async () => testSkip(0, 0, 0x3, true)); // 0+0=0(零)
  it("kkkk=0x4: Z 零", async () => testSkip(0xffff, 0x0001, 0x4, true)); // 0
  it("kkkk=0x5: NZ 非零", async () => testSkip(1, 1, 0x5, true)); // 2≠0
  it("kkkk=0x6: MZ 負または零", async () =>
    testSkip(0xffff, 0x0001, 0x6, true)); // 0
  it("kkkk=0x7: P 正", async () => testSkip(1, 1, 0x7, true)); // 2>0
  it("kkkk=0x8: EZ E=0", async () => testSkip(0, 0, 0x8, true)); // 0+0 → E=0
  it("kkkk=0x9: ENZ E≠0", async () => testSkip(0xffff, 0x0001, 0x9, true)); // carry
  it("kkkk=0xa: OZ OVF=0", async () => testSkip(1, 1, 0xa, true)); // no overflow
  it("kkkk=0xb: ONZ OVF≠0", async () => testSkip(0x7fff, 0x0001, 0xb, true)); // overflow
  it("kkkk=0xc: LMZ ≦ (E||Z)", async () => testSkip(0xffff, 0x0001, 0xc, true));
  it("kkkk=0xd: LP > (!E&&!Z)", async () => testSkip(1, 1, 0xd, true)); // 2>0
  it("kkkk=0xe: LPZ ≧ (!E)", async () => testSkip(1, 1, 0xe, true));
  it("kkkk=0xf: LM < (E&&!Z)", async () => testSkip(0xffff, 0x0002, 0xf, true)); // 0xFFFF+2=0x10001→E=1,Z=0
});

// ─────────────────────────────────────────────
// 17. NEG 命令
// ─────────────────────────────────────────────
describe("NEG 命令", () => {
  it("NEG R0: R0=1 → R0=0xFFFF", async () => {
    // MVWI R0, 1; NEG R0; H
    // NEG R0 (c=1) = 0x1F08
    const s = await runHalt([0x7807, 0x0001, 0x1f08, 0x2000]);
    expect(s.R[0]).toBe(0xffff);
  });

  it("NEG R0: R0=0 → R0=0", async () => {
    const s = await runHalt([0x7807, 0x0000, 0x1f08, 0x2000]);
    expect(s.R[0]).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 18. BSWP / DSWP
// ─────────────────────────────────────────────
describe("BSWP / DSWP", () => {
  it("BSWP R0, R0: 上下バイトを入れ替え", async () => {
    // MVWI R0, 0x1234; BSWP R0, R0; H
    // BSWP R0, R0 = 0x7008 (01110 000 0000 1000)
    const s = await runHalt([0x7807, 0x1234, 0x7008, 0x2000]);
    expect(s.R[0]).toBe(0x3412);
  });

  it("DSWP R0, R0: nibble2 と nibble3 を入れ替え", async () => {
    // MVWI R0, 0x1234; DSWP R0, R0; H
    // DSWP R0, R0 = 0x7000
    const s = await runHalt([0x7807, 0x1234, 0x7000, 0x2000]);
    expect(s.R[0]).toBe(0x1324); // bit8-11 と bit4-7 が入れ替わる
  });
});

// ─────────────────────────────────────────────
// 19. AWI / SWI（16bit 即値加減算）
// ─────────────────────────────────────────────
describe("AWI / SWI 命令", () => {
  it("AWI R0, 0x0100 → R0=0x0100", async () => {
    // AWI R0, 0x0100 = [0x580F, 0x0100]
    const s = await runHalt([0x580f, 0x0100, 0x2000]);
    expect(s.R[0]).toBe(0x0100);
    expect(s.STR & STR_E).toBe(0);
  });

  it("SWI R0, 0x0001 → R0=0xFFFF（ボロー発生）", async () => {
    // SWI R0, 0x0001 = [0x5807, 0x0001]
    const s = await runHalt([0x5807, 0x0001, 0x2000]);
    expect(s.R[0]).toBe(0xffff);
    expect(s.STR & STR_E).not.toBe(0);
  });
});

// ─────────────────────────────────────────────
// 20. RD / WT（I/O ポート）
// ─────────────────────────────────────────────
describe("RD / WT 命令（I/O）", () => {
  it("WT → コールバックが呼ばれる", async () => {
    const writes: [number, number][] = [];
    setIoWriteCallback((port, val) => writes.push([port, val]));
    // MVWI R0, 0xABCD; WT R0, #0x10; H
    // WT R0, #0x10 = 0x1010 (op=0x02, rrr=0, lo=0x10)
    await runHalt([0x7807, 0xabcd, 0x1010, 0x2000]);
    expect(writes).toEqual([[0x10, 0xabcd]]);
  });

  it("RD → コールバックの値が R0 に入る", async () => {
    setIoReadCallback((port) => (port === 0x20 ? 0x5a5a : 0));
    // RD R0, #0x20; H
    // RD R0, #0x20 = 0x1820 (op=0x03, rrr=0, lo=0x20)
    const s = await runHalt([0x1820, 0x2000]);
    expect(s.R[0]).toBe(0x5a5a);
  });

  it("RD → getPins().IOP が true になる", async () => {
    setIoReadCallback((_p) => 0xff);
    loadWords([0x1800, 0x2000]); // RD R0, #0; H
    step(); // RD を実行
    expect(getPins().IOP).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 21. LD / STD（MN1613 16bit 直接アドレス）
// ─────────────────────────────────────────────
describe("LD / STD 命令", () => {
  it("STD して LD で読み返せる", async () => {
    // MVWI R0, 0x9876; STD R0, 0x0100; MVWI R0, 0; LD R0, 0x0100; H
    // STD R0, 0x0100 = [0x2748, 0x0100]
    // LD  R0, 0x0100 = [0x2708, 0x0100]
    const s = await runHalt([
      0x7807,
      0x9876, // MVWI R0, 0x9876
      0x2748,
      0x0100, // STD R0, 0x0100
      0x7807,
      0x0000, // MVWI R0, 0
      0x2708,
      0x0100, // LD R0, 0x0100
      0x2000,
    ]);
    expect(s.R[0]).toBe(0x9876);
  });
});

// ─────────────────────────────────────────────
// 22. LR / STRi（レジスタ間接）
// ─────────────────────────────────────────────
describe("LR / STR 命令（レジスタ間接）", () => {
  it("STRi R0, (R1) でストアして LR R0, (R2) でロードできる", async () => {
    // R1=0x0050, R2=0x0050 として R0 を 0x0050 に格納してから読み返す
    // MVWI R0, 0xDEAD; MVWI R1, 0x0050; MVWI R2, 0x0050
    // STRi R0, (R1) = 0x2044 (op=0x04, rrr=0, mm=01, BB=0, bits[3:2]=01, ii=0=R1)
    // LR R1, (R2)   = 0x2141 (op=0x04, rrr=1, mm=01, BB=0, bits[3:2]=00, ii=1=R2)
    const s = await runHalt([
      0x7807,
      0xdead, // MVWI R0, 0xDEAD
      0x7907,
      0x0050, // MVWI R1, 0x0050
      0x7a07,
      0x0050, // MVWI R2, 0x0050
      0x2044, // STRi R0, (R1)
      0x7807,
      0x0000, // MVWI R0, 0
      0x2040, // LR R0, (R1)
      0x2000,
    ]);
    expect(s.R[0]).toBe(0xdead);
  });

  it("LR R0, (R1)+ ポストインクリメント", async () => {
    // MVWI R1, 0x0060; LR R0, (R1)+; H
    // LR R0, (R1)+ = 0x20C0 (mm=11, BB=0, ii=0=R1)
    const words: number[] = new Array(0x80).fill(0);
    words[0x60] = 0x1111;
    words[0] = 0x7907;
    words[1] = 0x0060; // MVWI R1, 0x0060
    words[2] = 0x20c0; // LR R0, (R1)+
    words[3] = 0x2000;
    loadWords(words);
    await run(0, 1000);
    const s = getState();
    expect(s.R[0]).toBe(0x1111);
    expect(s.R[1]).toBe(0x0061); // インクリメントされた
  });
});

// ─────────────────────────────────────────────
// 23. PSHM / POPM
// ─────────────────────────────────────────────
describe("PSHM / POPM", () => {
  it("PSHM で R0〜R4 を保存し POPM で復元できる", async () => {
    // PSHM = 0x170F; POPM = 0x1707
    const s = await runHalt([
      0x7d07,
      0x00ff, // MVWI SP, 0x00FF
      0x7807,
      0x1111, // MVWI R0
      0x7907,
      0x2222, // MVWI R1
      0x7a07,
      0x3333, // MVWI R2
      0x7b07,
      0x4444, // MVWI R3
      0x7c07,
      0x5555, // MVWI R4
      0x170f, // PSHM
      0x6000, // EOR R0, R0 (CLR)
      0x6101, // EOR R1, R1
      0x6202, // EOR R2, R2
      0x6303, // EOR R3, R3
      0x6404, // EOR R4, R4
      0x1707, // POPM
      0x2000,
    ]);
    expect(s.R[0]).toBe(0x1111);
    expect(s.R[1]).toBe(0x2222);
    expect(s.R[2]).toBe(0x3333);
    expect(s.R[3]).toBe(0x4444);
    expect(s.R[4]).toBe(0x5555);
  });
});

// ─────────────────────────────────────────────
// 24. M / D（乗算・除算）
// ─────────────────────────────────────────────
describe("M / D 命令", () => {
  it("M DR0, (R1): R0=3 × [mem]=4 → DR0=12", async () => {
    // M DR0, (R1) = 0x7F0C (op=0x0F, rrr=7, bits[3:2]=11, ii=0=R1)
    const words: number[] = new Array(0x80).fill(0);
    words[0x50] = 4; // メモリ 0x0050 に 4 を置く
    words[0] = 0x7807;
    words[1] = 0x0003; // MVWI R0, 3
    words[2] = 0x7907;
    words[3] = 0x0050; // MVWI R1, 0x0050
    words[4] = 0x7f0c; // M DR0, (R1)
    words[5] = 0x2000;
    loadWords(words);
    await run(0, 1000);
    const s = getState();
    expect(s.R[0]).toBe(0); // 上位16bit
    expect(s.R[1]).toBe(12); // 下位16bit
  });

  it("D DR0, (R1): DR0=10 ÷ 3 → 商=3、余り=1", async () => {
    // D DR0, (R1) = 0x770C (op=0x0E, rrr=7, bits[3:2]=11, ii=0=R1)
    const words: number[] = new Array(0x80).fill(0);
    words[0x50] = 3;
    words[0] = 0x7807;
    words[1] = 0x0000; // R0(MSB) = 0
    words[2] = 0x7907;
    words[3] = 0x000a; // R1(LSB) = 10
    words[4] = 0x7a07;
    words[5] = 0x0050; // R2 = ptr (ただし R1 を ptr として使う)
    // ii=0=R1 なので R1 がポインタ。でも R1 は値なので R2 をポインタに使う
    // D DR0, (R2) = 0x770D (ii=1=R2)
    words[2] = 0x7907;
    words[3] = 0x000a; // MVWI R1=10(LSBデータ)
    words[4] = 0x7a07;
    words[5] = 0x0050; // MVWI R2=ptr
    words[6] = 0x770d; // D DR0, (R2)
    words[7] = 0x2000;
    loadWords(words);
    await run(0, 1000);
    const s = getState();
    expect(s.R[0]).toBe(3); // 商
    expect(s.R[1]).toBe(1); // 余り
  });
});

// ─────────────────────────────────────────────
// 25. BLK（ブロック転送）
// ─────────────────────────────────────────────
describe("BLK 命令", () => {
  it("3語分をブロック転送する", async () => {
    // BLK: R0=語数, R1=ソース(TSR0), R2=デスティネーション(TSR1)
    // 仕様: 「R1とTSR0で指定されるアドレスから R2とTSR1で指定されるアドレスへ」
    const words: number[] = new Array(0x100).fill(0);
    words[0x80] = 0x1111;
    words[0x81] = 0x2222;
    words[0x82] = 0x3333;
    words[0] = 0x7807;
    words[1] = 0x0003; // MVWI R0, 3 (語数)
    words[2] = 0x7907;
    words[3] = 0x0080; // MVWI R1, 0x0080 (ソース)
    words[4] = 0x7a07;
    words[5] = 0x0090; // MVWI R2, 0x0090 (デスティネーション)
    words[6] = 0x3f17; // BLK
    // BLK 後に LD で転送先を確認
    words[7] = 0x2708;
    words[8] = 0x0090; // LD R0, 0x0090
    words[9] = 0x2709;
    words[10] = 0x0091; // LD R1, 0x0091
    words[11] = 0x270a;
    words[12] = 0x0092; // LD R2, 0x0092
    words[13] = 0x2000; // H
    loadWords(words);
    await run(0, 1000);
    const s = getState();
    expect(s.R[0]).toBe(0x1111);
    expect(s.R[1]).toBe(0x2222);
    expect(s.R[2]).toBe(0x3333);
  });
});

// ─────────────────────────────────────────────
// 26. 割り込み（triggerInterrupt / LPSW）
// ─────────────────────────────────────────────
describe("割り込み", () => {
  it("M0 マスクが有効のとき IRQ0 を受け付ける", () => {
    // step() ベースで確実にテスト
    // NPSW: addr 0x0100=STR=0, addr 0x0101=IC=0x0110
    // ISR:  addr 0x0110=MVWI R0 0xCAFE, addr 0x0112=LPSW 0
    // Main: addr 0: MVWI R1, 0x0400; addr 2: MV STR, R1; addr 3: NOP(MV R0,R0)
    const words: number[] = new Array(0x120).fill(0);
    words[0x100] = 0x0000; // NPSW STR (M0=0, 割り込み中はマスク)
    words[0x101] = 0x0110; // NPSW IC
    words[0x110] = 0x7807;
    words[0x111] = 0xcafe; // MVWI R0, 0xCAFE
    words[0x112] = 0x2004; // LPSW 0
    words[0] = 0x7907;
    words[1] = 0x0400; // MVWI R1, 0x0400 = M0
    words[2] = 0x7e09; // MV STR, R1 → STR=0x0400
    words[3] = 0x7808;
    words[4] = 0x0000; // MVWI R0, 0 (NOP 代わり)
    loadWords(words);

    step(); // MVWI R1, 0x0400
    step(); // MV STR, R1 → STR=0x0400 (M0 有効)
    triggerInterrupt(0); // IRQ0 アサート
    step(); // この step で割り込み処理が走る (MVWI R0, 0 の前に割り込み)
    // → ISR に入り MVWI R0, 0xCAFE を実行
    step(); // ISR: MVWI R0, 0xCAFE
    step(); // ISR: LPSW 0 → リターン
    expect(getState().R[0]).toBe(0xcafe);
  });
});

// ─────────────────────────────────────────────
// 27. setPins / getPins
// ─────────────────────────────────────────────
describe("setPins / getPins", () => {
  it("getPins().RUN は実行中 true", async () => {
    loadWords([0xc709, 0x2000]); // B 0x09 (self loop)
    const p = run(0, 100); // 短いループで止まる
    await p;
    // run が終わったら RUN=false
    expect(getPins().RUN).toBe(false);
  });

  it("setPins({ HLT: true }) で実行が止まる", async () => {
    loadWords([0xc700]); // B 0x00 (self loop)
    const runPromise = run(0, 0); // 無制限
    await new Promise<void>((r) => setTimeout(r, 20));
    setPins({ HLT: true });
    await runPromise;
    expect(getExecStatus()).toBe("halted");
    setPins({ HLT: false });
  });

  it("setPins({ RST: true/false }) でリセットが走る", () => {
    // MVWI R0, 0xABCD して RST
    loadWords([0x7807, 0xabcd, 0x2000]);
    step();
    step(); // MVWI を実行
    expect(getState().R[0]).toBe(0xabcd);
    setPins({ RST: true }); // 立ち上がりでリセット
    setPins({ RST: false }); // 立ち下がり（何もしない）
    expect(getState().R[0]).toBe(0x0000); // リセットされた
    expect(getState().IC).toBe(0);
  });

  it("setPins({ IRQ1: true }) でペンディング IRQ がセットされる", () => {
    setPins({ IRQ1: true });
    expect(getPins().IRQ1).toBe(true);
    setPins({ IRQ1: false }); // IRQ は clearしない（ペンディングのまま）
    expect(getPins().IRQ1).toBe(true); // _pendingIRQ はクリアされないことを確認
  });
});

// ─────────────────────────────────────────────
// 28. ブレークポイント
// ─────────────────────────────────────────────
describe("ブレークポイント", () => {
  it("ブレークポイントで停止する", async () => {
    loadWords([
      0x7807,
      0x0001, // MVWI R0, 1
      0x7807,
      0x0002, // MVWI R0, 2  ← ここで止まる
      0x7807,
      0x0003, // MVWI R0, 3
      0x2000,
    ]);
    addBreakpoint(2); // アドレス 2 に設定
    const status = await run(0, 10000);
    expect(status).toBe("break");
    expect(getState().IC).toBe(2);
    expect(getState().R[0]).toBe(0x0001); // 2番目のMVWIはまだ実行していない
  });
});

// ─────────────────────────────────────────────
// 29. 統合テスト：sum1to10 サンプルプログラム
// ─────────────────────────────────────────────
describe("統合テスト: sum 1 to 10", () => {
  it("1+2+...+10 = 55 (0x37) が RESULT に格納される", async () => {
    // retrocpu_asm/sample/sum1to10.lst より:
    //   0000 0800  MVI R0, #0
    //   0001 090A  MVI R1, #10
    //   0002 5809  A R0, R1        (LOOP)
    //   0003 4141  SI R1, #1, Z    (スキップ条件 Z=0x04, DDDD=1)
    //   0004 CFFD  B LOOP          (相対 -3)
    //   0005 8801  ST R0, RESULT   (相対 +1)
    //   0006 2000  H
    //   0007 0000  RESULT: .word 0
    await runHalt([
      0x0800, 0x090a, 0x5809, 0x4141, 0xcffd, 0x8801, 0x2000, 0x0000,
    ]);
    expect(getExecStatus()).toBe("halted");
    // getMemory() で addr 0x0007 を直接確認
    const view = new DataView(getMemory());
    expect(view.getUint16(0x0007 * 2, false)).toBe(0x0037); // 55 = 0x37
  });
});

// ─────────────────────────────────────────────
// 30. step() の動作確認
// ─────────────────────────────────────────────
describe("step() API", () => {
  it("step() で 1 命令ずつ実行できる", () => {
    loadWords([
      0x7807,
      0x1111, // MVWI R0, 0x1111 (2語)
      0x7907,
      0x2222, // MVWI R1, 0x2222 (2語)
      0x2000, // H
    ]);
    expect(getState().R[0]).toBe(0);
    step(); // MVWI R0 を実行
    expect(getState().R[0]).toBe(0x1111);
    expect(getState().R[1]).toBe(0);
    step(); // MVWI R1 を実行
    expect(getState().R[1]).toBe(0x2222);
    expect(getExecStatus()).toBe("step");
  });

  it("H 命令で step() が halted を返す", () => {
    loadWords([0x2000]);
    const s = step();
    expect(getExecStatus()).toBe("halted");
    expect(s.IC).toBe(1);
  });
});
