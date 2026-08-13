/**
 * IO↔CPU ボードリンク（MessagePort）
 *
 * - DMA は **書き込みのみ**（`dma:writeBytes` / `dma:writeWords`。読み込み不可）
 * - メモリ読みはハンドシェイク 50h（`hshk`）。DMA で読まない（16進キー RD/INC/DEC）
 * - メモリ書き・実行指示（51h / 49h、キーボードコンソール WINC / RUN）
 * - HALT / RESET 制御
 *
 * 実機では GPIO ハンドシェイク／DMA ピン。エミュではコマンド番号を保った RPC。
 */

import { CMD_IO_TO_CPU } from "./handshake/handshake_type";

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
      type: "hshk";
      id: number;
      cmd: typeof CMD_IO_TO_CPU.BREAK_MEM_IO_SET;
      /** コマンド除く 9 バイト（slot, flags, count, addr32 BE, data16 BE） */
      payload: ArrayBuffer;
    }
  | {
      type: "hshk";
      id: number;
      cmd: typeof CMD_IO_TO_CPU.BREAK_MEM_IO_CLR;
      /** ブレイク設定番号（0–5） */
      slot: number;
    }
  | {
      type: "cpu:setHalt";
      id: number;
      halt: boolean;
    }
  | {
      type: "cpu:pulseReset";
      id: number;
      /** IO:0000 へ積むリセットベクタ（ワードアドレス、任意） */
      resetVectorWord?: number;
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
 * CPU→IO コマンド（10h〜16h）のフレーム転送要求。
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
