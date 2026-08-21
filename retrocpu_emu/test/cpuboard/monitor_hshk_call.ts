/**
 * エミュ 13h/14h テストを BIOS 結合と同じ手順にする。
 * HALT→IRQ2 ではなく REQ_1 待ちのあと `g_handshake_interrupt_handler` を `run()` する。
 * 根拠: asm_test_framework.mdc / handshake_read_memory_test.ts
 */

import fs from "node:fs";
import { parseCdb } from "../../src/code_test/cdb";
import { writeWord } from "../../src/code_test/mn1613_harness";
import { OPCODE_H } from "../../src/cpuboard/io_ports";
import {
  cpuSlicePlan,
  handshakeBusyFromBus,
} from "../../src/cpuboard/cpu_slice";
import {
  getExecStatus,
  getState,
  run,
  setState,
  tickCpu,
} from "../../src/cpuboard/mn1613/mn1613";
import { resolveBootMonitorHexCdbPair } from "../../src/ioboard/io_reset";
import type { CpuIoSignals } from "../../src/cpuboard/mn1613/mn1613ioport";

/** BIOS 結合と同じ戻りスタブ（モニタ末尾） */
const RETURN_STUB_WORD = 0x17fe;

/** BIOS 結合と同じスタック初期値 */
const STACK_INIT = 0xffff;

/** 0x1220 バイトダンプ用（BIOS handshake テストと同じ） */
const HANDLER_MAX_CYCLES = 250_000_000;

/** CDB のグローバル名（`L:G$G_HANDSHAKE_INTERRUPT_HANDLER$...`） */
const HANDLER_CDB_NAME = "G_HANDSHAKE_INTERRUPT_HANDLER";

/**
 * モニタ CDB からハンドラのワードアドレスを取る。
 * @param cdbPath モニタ CDB（省略時は IHX+CDB 組から解決）
 * @returns `g_handshake_interrupt_handler` のワードアドレス
 */
export function handshakeHandlerWordAddr(cdbPath?: string): number {
  const resolved = cdbPath ?? resolveBootMonitorHexCdbPair().cdb;
  const table = parseCdb(fs.readFileSync(resolved, "utf8"));
  const key = HANDLER_CDB_NAME;
  const upper = key.toUpperCase();
  const sym =
    table.byName.get(key) ??
    table.byName.get(upper) ??
    [...table.byName.values()].find((s) => s.name.toUpperCase() === upper);
  if (!sym) {
    throw new Error(`CDB symbol not found: ${key}`);
  }
  return sym.wordAddr;
}

/**
 * IO が HSHK_IN_REQ を上げるまで待つ。
 * @param bus ハンドシェイクバス
 * @param timeoutMs 上限 ms
 */
export async function waitReq1(
  bus: CpuIoSignals,
  timeoutMs = 5000,
): Promise<void> {
  const t0 = Date.now();
  while (bus.HSHK_IN_REQ !== 1) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting HSHK_IN_REQ");
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * BIOS `session.call("g_handshake_interrupt_handler")` 相当。
 * メモリとピンは維持し、SP に戻りスタブを積んで `run()` する。
 * @param entryWordAddr ハンドラ入口
 */
export async function callHandshakeHandler(
  entryWordAddr: number,
): Promise<void> {
  writeWord(RETURN_STUB_WORD, OPCODE_H);
  let sp = STACK_INIT;
  writeWord(sp, RETURN_STUB_WORD);
  sp = (sp - 1) & 0xffff;
  setState({ SP: sp });
  const status = await run(entryWordAddr, HANDLER_MAX_CYCLES);
  const ic = getState().IC & 0xffff;
  const stub = RETURN_STUB_WORD & 0xffff;
  if (status !== "halted") {
    throw new Error(
      `g_handshake_interrupt_handler: status=${status} IC=0x${ic.toString(16)}`,
    );
  }
  if (ic !== stub && ic !== ((stub + 1) & 0xffff)) {
    throw new Error(
      `g_handshake_interrupt_handler: did not return to stub (IC=0x${ic.toString(16)}, stub=0x${stub.toString(16)})`,
    );
  }
}

/**
 * IO→CPU 操作を開始し、REQ_1 のあとハンドラを呼んで完了を待つ。
 * @param bus ハンドシェイクバス
 * @param entryWordAddr ハンドラ入口
 * @param start 操作開始（`memRead` など。まだ await しない）
 * @returns start の結果
 */
export async function withHandshakeHandler<T>(
  bus: CpuIoSignals,
  entryWordAddr: number,
  start: () => Promise<T>,
): Promise<T> {
  const pending = start();
  await waitReq1(bus);
  await callHandshakeHandler(entryWordAddr);
  return pending;
}

/**
 * TCP など操作開始点がテスト側に無いとき、REQ_1 ごとにハンドラを呼ぶ。
 * @param bus ハンドシェイクバス
 * @param entryWordAddr ハンドラ入口
 * @returns 停止関数
 */
export function startHandshakeHandlerLoop(
  bus: CpuIoSignals,
  entryWordAddr: number,
): () => void {
  let alive = true;
  let busy = false;
  let pending = false;
  const loop = async (): Promise<void> => {
    while (alive) {
      const req = bus.HSHK_IN_REQ;
      if (req === 1) pending = true;
      if (req === 0) pending = false;
      if (!busy && pending && getExecStatus() === "halted") {
        busy = true;
        try {
          await callHandshakeHandler(entryWordAddr);
        } catch {
          // REQ held-high timing can race in tests; keep loop alive and wait for next state.
        } finally {
          pending = false;
          busy = false;
        }
      } else {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  };
  void loop();
  return () => {
    alive = false;
  };
}

/**
 * CPU Worker のスライス相当で tick する（IRQ2 経路用）。
 * ハンドシェイク中は 4096 命令＋ delay 0。IO の waitCondition も tick する。
 * @param bus ハンドシェイクバス
 * @returns 停止関数
 */
export function startWorkerSlicePump(bus: CpuIoSignals): () => void {
  let alive = true;
  const loop = (): void => {
    if (!alive) return;
    const plan = cpuSlicePlan(handshakeBusyFromBus(bus), 32, 0);
    for (let i = 0; i < plan.steps; i += 1) tickCpu();
    setTimeout(loop, plan.delayMs);
  };
  loop();
  return () => {
    alive = false;
  };
}
