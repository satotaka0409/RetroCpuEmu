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
    };

export type BoardLinkResponse = {
  type: "link:result";
  id: number;
  ok: boolean;
  error?: string;
  /** MEM_READ 時のペイロード（ビッグエンディアンバイト列） */
  data?: ArrayBuffer;
};

export { CMD_IO_TO_CPU };
