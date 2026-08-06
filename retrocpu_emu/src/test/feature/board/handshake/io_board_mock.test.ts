/**
 * IoBoardHandshakeMock — MN1613 モニター相手の I/O ボードモック
 * 根拠: HandShake.mdc
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RetroCpuHandshake } from "../../../../main/feature/cpu/mn1613/handhshake/handshake_retrocpu";
import {
  buildBeepFrame,
  buildModeSetFrame,
  buildCpuStatusFrame,
  reg16,
  reg24,
  type CpuRegisters,
} from "../../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../../main/feature/cpu/mn1613/handhshake/handshake_type";
import {
  createIoBoardHandshakeMock,
  IoBoardHandshakeMock,
} from "../../../../main/feature/board/handshake/io_board_mock";
import {
  getPendingIrq,
  getPins,
  reset,
  setPins,
} from "../../../../main/feature/cpu/mn1613/mn1613";

const SAMPLE_REGS: CpuRegisters = {
  R0: reg16(0x1111),
  R1: reg16(0x2222),
  R2: reg16(0x3333),
  R3: reg16(0x4444),
  R4: reg16(0x5555),
  SP: reg24(0x00ffff),
  STR: reg24(0xe00000),
  IC: reg16(0x0200),
  CSBR: reg16(0),
  SSBR: reg16(0),
  TSR0: reg16(0),
  TSR1: reg16(0),
  OSR0: reg16(0),
  OSR1: reg16(0),
  OSR2: reg24(0),
  NPP: reg16(0),
  IISR: reg16(0),
  SBRB: reg16(0),
  ICB: reg16(0),
};

/** CPU→IO 送信後、応答セッションを並行受信する */
async function sendCommandAndReceiveResponse(
  cpu: RetroCpuHandshake,
  mock: IoBoardHandshakeMock,
  frame: Uint8Array,
  responseLen: number,
): Promise<Uint8Array> {
  const ioSide = mock.handleOneRequest();
  await cpu.send(frame);
  const [resp] = await Promise.all([cpu.receive(responseLen), ioSide]);
  return resp;
}

describe("IoBoardHandshakeMock", () => {
  let mock: IoBoardHandshakeMock;
  let cpu: RetroCpuHandshake;

  beforeEach(() => {
    setPins({
      HLT: false,
      RST: false,
      IRQ0: false,
      IRQ1: false,
      IRQ2: false,
      BSAV: false,
      STRT: false,
    });
    reset();
    mock = createIoBoardHandshakeMock({ timeoutMs: 1000 });
    cpu = new RetroCpuHandshake(mock.bus, 1000);
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  it("モード設定(0x11)を受信し OK を返し state.mode を更新する", async () => {
    const resp = await sendCommandAndReceiveResponse(
      cpu,
      mock,
      buildModeSetFrame(MODE.FREE),
      1,
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.mode).toBe(MODE.FREE);
    expect(mock.state.log).toHaveLength(1);
    expect(mock.state.log[0]!.cmd).toBe(CMD_CPU_TO_IO.MODE_SET);
  });

  it("CPU状態通知(0x10)で lastCpuRegs を保持する", async () => {
    const resp = await sendCommandAndReceiveResponse(
      cpu,
      mock,
      buildCpuStatusFrame(SAMPLE_REGS),
      1,
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.lastCpuRegs).not.toBeNull();
    expect(Number(mock.state.lastCpuRegs!.R0)).toBe(0x1111);
    expect(Number(mock.state.lastCpuRegs!.IC)).toBe(0x0200);
  });

  it("receiveFramed: 複数バイトを同一セッションで受信する（BEEP）", async () => {
    const resp = await sendCommandAndReceiveResponse(
      cpu,
      mock,
      buildBeepFrame({ frequencyHz: 440, durationMs: 100 }),
      1,
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.lastBeep).toEqual({ frequencyHz: 440, durationMs: 100 });
  });

  it("sendToCpu で HSHK_REQ_1 → IRQ2 / pending が立つ", async () => {
    const payload = new Uint8Array([0x48, 0x00]);
    const recvP = cpu.receive(2);
    const sendP = mock.sendToCpu(payload);
    const [got] = await Promise.all([recvP, sendP]);

    expect([...got]).toEqual([0x48, 0x00]);
    expect(getPins().IRQ2).toBe(false);
    expect(getPendingIrq() & 0x04).toBe(0x04);
  });

  it("フリーモード時のみ hex key が OK", async () => {
    mock.setHexKeys([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]);

    const ng = await sendCommandAndReceiveResponse(
      cpu,
      mock,
      new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]),
      9,
    );
    expect(ng[8]).toBe(RESPONSE_CODE.NG_MODE_ERROR);

    await sendCommandAndReceiveResponse(
      cpu,
      mock,
      buildModeSetFrame(MODE.FREE),
      1,
    );

    const ok = await sendCommandAndReceiveResponse(
      cpu,
      mock,
      new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]),
      9,
    );
    expect([...ok.slice(0, 8)]).toEqual([
      0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80,
    ]);
    expect(ok[8]).toBe(RESPONSE_CODE.OK);
  });
});
