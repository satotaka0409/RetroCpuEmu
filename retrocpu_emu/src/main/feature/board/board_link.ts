/**
 * IO↔CPU ボードリンク（MessagePort）
 *
 * - DMA 書き込み（Cursor HEX 等）
 * - ハンドシェイク相当のメモリ R/W・実行指示（キーボードコンソール）
 * - HALT / RESET 制御
 *
 * 実機では GPIO ハンドシェイク／DMA ピン。エミュではコマンド番号を保った RPC。
 */

import { CMD_IO_TO_CPU } from "../cpu/mn1613/handhshake/handshake_type";

export type BoardLinkRequest =
  | {
      type: "dma:writeBytes";
      id: number;
      byteAddr: number;
      data: ArrayBuffer;
    }
  | {
      type: "dma:writeWords";
      id: number;
      wordAddr: number;
      words: number[];
    }
  | {
      type: "hshk";
      id: number;
      cmd: typeof CMD_IO_TO_CPU.MEM_READ;
      /** ワードアドレス */
      wordAddr: number;
      /** 読み込みバイト数 */
      byteCount: number;
    }
  | {
      type: "hshk";
      id: number;
      cmd: typeof CMD_IO_TO_CPU.MEM_WRITE;
      wordAddr: number;
      data: ArrayBuffer;
    }
  | {
      type: "hshk";
      id: number;
      cmd: typeof CMD_IO_TO_CPU.EXEC;
      wordAddr: number;
    }
  | {
      type: "cpu:setHalt";
      id: number;
      halt: boolean;
    }
  | {
      type: "cpu:pulseReset";
      id: number;
    }
  | {
      /** IO ボードから CPU への割り込み要求（タイマー等）。実機は IRQ 線 + 要因線 */
      type: "cpu:irq";
      id: number;
      /** 割り込みレベル（MN1613 は 0〜2） */
      level: 0 | 1 | 2;
      /** 割り込み要因（INT_CAUSE_CODE） */
      cause: number;
    };

export type BoardLinkResponse = {
  type: "link:result";
  id: number;
  ok: boolean;
  error?: string;
  /** MEM_READ 時のペイロード（ビッグエンディアンバイト列） */
  data?: ArrayBuffer;
};

/**
 * CPU→IO コマンド（10h〜1ah）のフレーム転送要求。
 *
 * 実機では 1階ボードが線を直接読む。エミュでは CPU ボード Worker が
 * ビットレベルのハンドシェイクでフレームを組み立て、これで IO ボード Worker へ渡す。
 */
export type CpuToIoFrameRequest = {
  type: "cpuio:frame";
  id: number;
  /** コマンドバイトを含む受信済みフレーム */
  frame: ArrayBuffer;
};

/** CPU→IO コマンドに対する IO ボードの応答 */
export type CpuToIoFrameResponse = {
  type: "cpuio:result";
  id: number;
  ok: boolean;
  error?: string;
  /** CPU へ返すバイト列（無応答コマンドなら空） */
  response?: ArrayBuffer;
};

export { CMD_IO_TO_CPU };
