import { describe, expect, it } from "vitest";
import {
  BREAK_RDWR_RD,
  BREAK_RDWR_WR,
} from "../../../src/cpuboard/mn1613/addr_comparator";
import {
  Tms9995IoMmap,
  TMS9995_IO_BREAK_ADDR_HI,
  TMS9995_IO_BREAK_ADDR_LO,
  TMS9995_IO_BREAK_CTRL,
  TMS9995_IO_BREAK_HIT,
  TMS9995_IO_BREAK_PREV,
  TMS9995_IO_BREAK_SLOT,
  TMS9995_IO_STEP_DELAY,
  TMS9995_IO_STEP_ENA,
} from "../../../src/cpuboard/tms9995";

describe("Tms9995IoMmap", () => {
  it("FE80→FE81→FE82→FE83 の順で比較器を設定できる", () => {
    const io = new Tms9995IoMmap();
    // slot=1, ENA=1, MEM, RD
    io.writeByte(TMS9995_IO_BREAK_SLOT, 0x01);
    io.writeByte(TMS9995_IO_BREAK_CTRL, (1 << 3) | (BREAK_RDWR_RD << 5));
    io.writeByte(TMS9995_IO_BREAK_ADDR_HI, 0x12);
    io.writeByte(TMS9995_IO_BREAK_ADDR_LO, 0x34);

    const slot = io.comparators.getSlot(1)!;
    expect(slot.enabled).toBe(true);
    expect(slot.io).toBe(false);
    expect(slot.rdwr).toBe(BREAK_RDWR_RD);
    expect(slot.addr).toBe(0x1234);
  });

  it("途中で FE80 を書くとシーケンスがリセットされる", () => {
    const io = new Tms9995IoMmap();
    io.writeByte(TMS9995_IO_BREAK_SLOT, 0x00);
    io.writeByte(TMS9995_IO_BREAK_CTRL, (1 << 3) | (BREAK_RDWR_RD << 5));
    io.writeByte(TMS9995_IO_BREAK_SLOT, 0x02);
    io.writeByte(TMS9995_IO_BREAK_ADDR_HI, 0xaa);
    io.writeByte(TMS9995_IO_BREAK_ADDR_LO, 0xbb);
    // FE81 無しなのでコミットされない
    expect(io.comparators.getSlot(2)!.enabled).toBe(false);
  });

  it("ヒット番号読取で前回書き込み値が FE85 に現れる", () => {
    const io = new Tms9995IoMmap();
    io.writeByte(TMS9995_IO_BREAK_SLOT, 0x00);
    io.writeByte(TMS9995_IO_BREAK_CTRL, (1 << 3) | (BREAK_RDWR_WR << 5));
    io.writeByte(TMS9995_IO_BREAK_ADDR_HI, 0x00);
    io.writeByte(TMS9995_IO_BREAK_ADDR_LO, 0x40);

    expect(
      io.probe({ addr: 0x40, io: false, write: true, data: 0x99, prev: 0x55 }),
    ).toBe(0);
    expect(io.readByte(TMS9995_IO_BREAK_HIT)).toBe(0);
    expect(io.readByte(TMS9995_IO_BREAK_PREV)).toBe(0x55);
  });

  it("ステップ ENA/DELAY を FE86/FE87 で設定できる", () => {
    let hit = 0;
    const io = new Tms9995IoMmap();
    io.setOnHit(null, () => {
      hit += 1;
    });
    io.writeByte(TMS9995_IO_STEP_DELAY, 0x01);
    io.writeByte(TMS9995_IO_STEP_ENA, 1);
    expect(io.readByte(TMS9995_IO_STEP_ENA)).toBe(1);

    io.onInstructionFetch(0x1000); // skip first
    io.onInstructionFetch(0x1000); // remaining 2→1
    io.onInstructionFetch(0x1000); // remaining 1→0 → hit
    expect(hit).toBe(1);
    expect(io.readByte(TMS9995_IO_STEP_ENA)).toBe(0);
  });
});
