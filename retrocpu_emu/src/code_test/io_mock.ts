/**
 * コードテスト用 IO モック（ポート固定値 + 任意でハンドシェイク）
 * 根拠: .cursor/rules/emulater_code_test.mdc §7
 */

import { addrComparators } from "../cpuboard/mn1613/addr_comparator";
import { stepBreak } from "../cpuboard/mn1613/step_break";
import {
  setIoReadCallback,
  setIoWriteCallback,
  triggerInterrupt,
} from "../cpuboard/mn1613/mn1613";
import {
  createHandshakeIoPortBridge,
  IoBoardHandshakeMock,
  type HandshakeIoPortBridge,
} from "../ioboard/handshake";
import { INT_CAUSE_CODE } from "../shared/handshake/handshake_type";
import type { CodeTestIoMockEntry, CodeTestIoWriteLog } from "./types";

/**
 * JSON の整数（10進 / 0x / 0b）を解釈する（ビットマスクなし）。
 * @param v 数値または文字列
 * @param label エラーメッセージ用
 * @returns 非負整数
 * @throws 解釈できない場合
 */
export function parseJsonInt(v: number | string, label: string): number {
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    const s = v.trim();
    if (/^0x[0-9a-f]+$/i.test(s)) {
      n = Number.parseInt(s, 16);
    } else if (/^0b[01]+$/i.test(s)) {
      n = Number.parseInt(s.slice(2), 2);
    } else if (/^[0-9]+$/.test(s)) {
      n = Number(s);
    } else {
      throw new Error(`${label}: invalid number '${v}'`);
    }
  }
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${label}: expected non-negative integer, got ${String(v)}`);
  }
  return n;
}

/**
 * JSON の数値を 16bit に正規化する（ポート番号・RD 値向け）。
 * @param v 数値または文字列
 * @param label エラーメッセージ用
 * @returns 0–0xFFFF
 */
export function parseJsonNumber(v: number | string, label: string): number {
  return parseJsonInt(v, label) & 0xffff;
}

/**
 * RD/WT コールバックをエミュ既定（RD=0xFFFF、WT 無視）に戻す。
 */
export function resetDefaultIoCallbacks(): void {
  setIoReadCallback((_p) => 0xffff);
  setIoWriteCallback((_p, _v) => {});
}

/**
 * port エントリの read を 16bit 配列にする。
 * @param read 設定値
 * @param label エラー用
 * @returns 空ならフォールバック扱い
 */
function normalizeReads(
  read: number | string | Array<number | string> | undefined,
  label: string,
): number[] {
  if (read === undefined) return [];
  const list = Array.isArray(read) ? read : [read];
  return list.map((v, i) => parseJsonNumber(v, `${label}[${i}]`));
}

/**
 * 設定 JSON の ioMock エントリから RD/WT モックを組み立て、エミュにアタッチする。
 */
export class CodeTestIoMock {
  /** handshake エントリがあるときだけ生成 */
  readonly handshake: IoBoardHandshakeMock | null;
  /** WT の時系列（ポートモック・handshake 転送とも記録） */
  readonly writes: CodeTestIoWriteLog[] = [];

  private readonly portReads = new Map<number, number[]>();
  private readonly portReadIndex = new Map<number, number>();
  private readonly handshakeBridge: HandshakeIoPortBridge | null;
  private readonly startServe: boolean;
  private attached = false;

  /**
   * @param entries 設定 JSON の `ioMock` 配列（1 件以上）
   */
  constructor(entries: CodeTestIoMockEntry[]) {
    if (entries.length === 0) {
      throw new Error("ioMock: empty entry list");
    }
    let handshake: IoBoardHandshakeMock | null = null;
    let startServe = false;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i]!;
      if (e.type === "handshake") {
        if (handshake) {
          throw new Error("ioMock: duplicate handshake entry");
        }
        handshake = new IoBoardHandshakeMock({
          timeoutMs: e.timeoutMs,
          syncIrq2: e.syncIrq2 ?? false,
          timerScheduler: e.timerScheduler,
        });
        startServe = e.start === true;
        continue;
      }
      if (e.type !== undefined && e.type !== "port") {
        throw new Error(`ioMock[${i}]: unknown type '${String(e.type)}'`);
      }
      if (!("port" in e)) {
        throw new Error(`ioMock[${i}]: port mock requires 'port'`);
      }
      const port = parseJsonNumber(e.port, `ioMock[${i}].port`);
      this.portReads.set(port, normalizeReads(e.read, `ioMock[${i}].read`));
      this.portReadIndex.set(port, 0);
    }
    this.handshake = handshake;
    this.startServe = startServe;
    this.handshakeBridge = handshake
      ? createHandshakeIoPortBridge(handshake.bus)
      : null;
  }

  /**
   * エミュレータの RD/WT をこのモックへ差し替える。
   * handshake があればバスも attach する。
   * 0030–0034 は CPLD 比較器へ通し、一致時は INT1・INT1_CAUSE=0。
   * 0036–0037 はステップ。ヒット時は INT1・INT1_CAUSE=1。
   */
  attach(): void {
    if (this.attached) return;
    addrComparators.reset();
    addrComparators.setOnHit(() => {
      if (this.handshake) {
        this.handshake.bus.INT_CAUSE = INT_CAUSE_CODE.ADDR_BREAK;
      }
      triggerInterrupt(1);
    });
    stepBreak.reset();
    stepBreak.setOnHit(() => {
      if (this.handshake) {
        this.handshake.bus.INT_CAUSE = INT_CAUSE_CODE.STEP;
      }
      triggerInterrupt(1);
    });
    if (this.handshake) {
      this.handshake.attach();
    }
    setIoReadCallback((port) => this.read(port));
    setIoWriteCallback((port, val) => this.write(port, val));
    if (this.handshake && this.startServe) {
      this.handshake.start();
    }
    this.attached = true;
  }

  /**
   * モックを外し、RD/WT を既定に戻す。
   */
  async detach(): Promise<void> {
    if (!this.attached) {
      resetDefaultIoCallbacks();
      return;
    }
    if (this.handshake) {
      await this.handshake.stop();
      this.handshake.detach();
    }
    addrComparators.reset();
    addrComparators.setOnHit(null);
    stepBreak.reset();
    stepBreak.setOnHit(null);
    resetDefaultIoCallbacks();
    this.attached = false;
  }

  /**
   * RD。port エントリがあればその値、なければ比較器 0030–0034、ステップ 0036–0037、handshake、0xFFFF。
   * @param port IO ポート番号
   * @returns 16bit
   */
  read(port: number): number {
    const p = port & 0xffff;
    const queue = this.portReads.get(p);
    if (queue && queue.length > 0) {
      const idx = this.portReadIndex.get(p) ?? 0;
      const v = queue[Math.min(idx, queue.length - 1)]!;
      if (idx < queue.length) {
        this.portReadIndex.set(p, idx + 1);
      }
      return v & 0xffff;
    }
    const breakVal = addrComparators.readPort(p);
    if (breakVal !== null) {
      return breakVal & 0xffff;
    }
    const stepVal = stepBreak.readPort(p);
    if (stepVal !== null) {
      return stepVal & 0xffff;
    }
    if (this.handshakeBridge) {
      return this.handshakeBridge.read(p) & 0xffff;
    }
    return 0xffff;
  }

  /**
   * WT。常に writes へ残し、port オーバーレイでなければ handshake へ転送する。
   * @param port IO ポート番号
   * @param val 16bit 値
   */
  write(port: number, val: number): void {
    const p = port & 0xffff;
    const v = val & 0xffff;
    this.writes.push({ port: p, value: v });
    const overlay = this.portReads.has(p);
    if (!overlay) {
      if (addrComparators.writePort(p, v)) {
        return;
      }
      if (stepBreak.writePort(p, v)) {
        return;
      }
      this.handshakeBridge?.write(p, v);
    }
  }
}
