/**
 * CPU アセンブラ BIOS ↔ IO TypeScript タイマー設定結合テスト
 * 根拠: HandShake.mdc「タイマー設定」(19h) / boot_monitor.mdc「タイマー割り込み」
 *
 * gl_bios_timer_set が線上に流す 6 バイト（19h, 番号, 周期H, 周期L, 回数H, 回数L）が
 * IO ボード側のコマンド解釈と一致し、指定した番号のタイマーが動き出すことを確認する。
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMemory,
  reset,
  run,
  setIoReadCallback,
  setIoWriteCallback,
  setMemory,
  setPins,
} from "../../../../../main/feature/cpu/mn1613/mn1613";
import { createHandshakeIoPortBridge } from "../../../../../main/feature/board/handshake/io_port_bridge";
import {
  createIoBoardHandshakeMock,
  type IoBoardHandshakeMock,
} from "../../../../../main/feature/board/handshake/io_board_mock";
import type {
  IoTimerHandle,
  IoTimerScheduler,
} from "../../../../../main/feature/board/io_timer";
import { RESPONSE_CODE } from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_type";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
);
const asmRoot = path.join(repoRoot, "retrocpu_asm");
const { expandIncludesFromFile } = require(
  path.join(asmRoot, "dist/main/cli.js"),
) as {
  expandIncludesFromFile: (p: string) => string;
};
const { assemble } = require(path.join(asmRoot, "dist/main/assembler.js")) as {
  assemble: (
    src: string,
    cpu: string,
  ) => {
    words: { address: number; value: number }[];
    symbols: Map<string, number>;
  };
};

const biosAsmDir = path.join(repoRoot, "retrocpu_boot_monitor/mn1613/src/bios");

/**
 * BIOS 用アセンブラソースを include 展開してアセンブルする。
 * @param name bios ディレクトリ内のファイル名
 * @returns ワード列とシンボル表（シンボル名は大文字）
 */
function assembleFile(name: string): {
  words: { address: number; value: number }[];
  symbols: Map<string, number>;
} {
  return assemble(
    expandIncludesFromFile(path.join(biosAsmDir, name)),
    "mn1613",
  );
}

/**
 * 新しいメモリを用意し、アドレス指定付きのワードを配置する（範囲外は無視）。
 * @param words アドレスと値の組
 */
function loadSparse(words: { address: number; value: number }[]): void {
  const buf = new ArrayBuffer(0x20000);
  const view = new DataView(buf);
  for (const w of words) {
    const off = (w.address & 0xffff) * 2;
    if (off + 1 < view.byteLength) {
      view.setUint16(off, w.value & 0xffff, false);
    }
  }
  setMemory(buf);
}

/**
 * メモリから 1 ワード読む。
 * @param addr ワードアドレス
 * @returns 16bit 値
 */
function readWord(addr: number): number {
  const view = new DataView(getMemory());
  return view.getUint16((addr & 0xffff) * 2, false);
}

/**
 * メモリへ 1 ワード書く。
 * @param addr ワードアドレス
 * @param value 16bit 値
 */
function writeWord(addr: number, value: number): void {
  new DataView(getMemory()).setUint16((addr & 0xffff) * 2, value & 0xffff, false);
}

/**
 * 満了させないスケジューラを作る。
 * 実時間で割り込みが飛ばないようにしつつ、稼働状態だけを観測するために使う。
 * @returns 予約を保持するだけのスケジューラ
 */
function createInertScheduler(): IoTimerScheduler {
  let nextId = 1;
  return {
    /**
     * 予約を登録する（発火はしない）。
     * @returns 予約 ID をハンドルとして返す
     */
    setTimeout(): IoTimerHandle {
      return nextId++ as unknown as IoTimerHandle;
    },
    /** 予約を破棄する（保持していないので何もしない） */
    clearTimeout(): void {},
  };
}

describe("asm BIOS タイマー設定 (19h)", () => {
  let mock: IoBoardHandshakeMock;

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
    // 応答送信でも HSHK_REQ_1 経由で IRQ2 が上がるため、CPU 実行を乱さないよう切る
    mock = createIoBoardHandshakeMock({
      timeoutMs: 5000,
      timerScheduler: createInertScheduler(),
      syncIrq2: false,
    });
    const bridge = createHandshakeIoPortBridge(mock.bus);
    setIoReadCallback((p) => bridge.read(p));
    setIoWriteCallback((p, v) => bridge.write(p, v));
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  /**
   * ドライバに引数を書き込んで 19h を 1 回発行する。
   * @param timerNo タイマー番号
   * @param periodMs 周期 (ms)。0 で停止
   * @param count 回数。0 で無限
   * @returns IO ボードが返したステータス（R0 の保存値）
   */
  async function callBiosTimerSet(
    timerNo: number,
    periodMs: number,
    count: number,
  ): Promise<number> {
    const img = assembleFile("bios_timer_test.asm");
    loadSparse(img.words);
    writeWord(img.symbols.get("GL_BIOS_TIMER_TEST_NO")!, timerNo);
    writeWord(img.symbols.get("GL_BIOS_TIMER_TEST_PERIOD")!, periodMs);
    writeWord(img.symbols.get("GL_BIOS_TIMER_TEST_COUNT")!, count);

    const ioSide = mock.handleOneRequest();
    const [status] = await Promise.all([run(0x0200, 2_000_000), ioSide]);
    expect(status).toBe("halted");
    return readWord(img.symbols.get("GL_BIOS_TIMER_TEST_RESULT")!);
  }

  it(
    "番号 1・周期 100ms・回数 3 がそのまま IO ボードへ届く",
    async () => {
      expect(await callBiosTimerSet(1, 100, 3)).toBe(RESPONSE_CODE.OK);
      expect(mock.state.lastTimer).toEqual({
        timerNo: 1,
        periodMs: 100,
        count: 3,
      });
      expect(mock.timers[0].running).toBe(false);
      expect(mock.timers[1].getState()).toMatchObject({
        running: true,
        periodMs: 100,
        count: 3,
      });
    },
    20000,
  );

  it(
    "番号 0 は 16bit 周期をそのまま送る",
    async () => {
      expect(await callBiosTimerSet(0, 0x1234, 0)).toBe(RESPONSE_CODE.OK);
      expect(mock.state.lastTimer).toEqual({
        timerNo: 0,
        periodMs: 0x1234,
        count: 0,
      });
      expect(mock.timers[0].running).toBe(true);
      expect(mock.timers[1].running).toBe(false);
    },
    20000,
  );

  it(
    "番号が 0/1 以外なら IO ボードが NG を返しタイマーは動かない",
    async () => {
      expect(await callBiosTimerSet(2, 100, 0)).toBe(RESPONSE_CODE.NG);
      expect(mock.timers[0].running).toBe(false);
      expect(mock.timers[1].running).toBe(false);
    },
    20000,
  );
});
