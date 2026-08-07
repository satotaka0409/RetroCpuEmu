/**
 * IO ボード前面パネル（ioboard.mdc ファンクションキー）
 *
 * キーボードからのメモリ R/W はハンドシェイク（50h/51h）。
 * 実行は 49h。表示はパネル自身が 7セグを駆動（モニタは 0x16 を使わない）。
 */

import { wordToSegDigits } from "./seg_font";
import { applyLedDisplayCommand } from "./io_led";
import { CMD_IO_TO_CPU } from "./board_link";
import { FN_KEY_LABELS } from "../../../shared/fn_keys";

export type ConsoleFocus = "addr" | "data";

export type ConsoleFnKey =
  | "F0"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7";

export { FN_KEY_LABELS };

/** CPU ボードへのハンドシェイク／制御（IO Worker が実装） */
export type ConsoleCpuBridge = {
  /** ハンドシェイク MEM_READ (0x50): ワードアドレスから 1 ワード読む */
  memReadWord(wordAddr: number): Promise<number>;
  /** ハンドシェイク MEM_WRITE (0x51): 1 ワード書く */
  memWriteWord(wordAddr: number, word: number): Promise<void>;
  /** ハンドシェイク EXEC (0x49) */
  exec(wordAddr: number): Promise<void>;
  setHalt(halt: boolean): Promise<void>;
  pulseReset(): Promise<void>;
  /** 現在 HALT 相当か（表示用） */
  isHalted(): boolean;
};

export type IoConsoleState = {
  /** ワードアドレス（ADDR 8 桁表示） */
  wordAddr: number;
  /** データワード（DATA 4 桁） */
  dataWord: number;
  focus: ConsoleFocus;
  halted: boolean;
};

export class IoConsole {
  private wordAddr = 0;
  private dataWord = 0;
  private focus: ConsoleFocus = "addr";
  private halted = true;

  constructor(private readonly cpu: ConsoleCpuBridge) {
    this.refreshLeds();
  }

  getState(): IoConsoleState {
    return {
      wordAddr: this.wordAddr >>> 0,
      dataWord: this.dataWord & 0xffff,
      focus: this.focus,
      halted: this.halted,
    };
  }

  /** 16進キー 0–F */
  onHex(digit: string): void {
    const n = parseInt(digit, 16);
    if (Number.isNaN(n)) return;
    if (this.focus === "addr") {
      this.wordAddr = ((this.wordAddr << 4) | (n & 0xf)) >>> 0;
    } else {
      this.dataWord = ((this.dataWord << 4) | (n & 0xf)) & 0xffff;
    }
    this.refreshLeds();
  }

  async onFunction(fn: ConsoleFnKey): Promise<void> {
    switch (fn) {
      case "F0": // ADS
        this.focus = this.focus === "addr" ? "data" : "addr";
        this.refreshLeds();
        break;
      case "F1": // RD
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F2": // INC
        this.wordAddr = (this.wordAddr + 1) >>> 0;
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F3": // DEC
        this.wordAddr = (this.wordAddr - 1) >>> 0;
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F4": // WINC
        await this.cpu.memWriteWord(this.wordAddr, this.dataWord);
        this.wordAddr = (this.wordAddr + 1) >>> 0;
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F5": // RUN
        await this.cpu.exec(this.wordAddr);
        this.halted = false;
        this.refreshLeds();
        break;
      case "F6": // H/ST
        if (this.halted || this.cpu.isHalted()) {
          await this.cpu.setHalt(false);
          this.halted = false;
        } else {
          await this.cpu.setHalt(true);
          this.halted = true;
        }
        this.refreshLeds();
        break;
      case "F7": // RST
        await this.cpu.pulseReset();
        this.halted = true;
        this.refreshLeds();
        break;
      default:
        break;
    }
  }

  private async readAt(wordAddr: number): Promise<void> {
    this.dataWord = (await this.cpu.memReadWord(wordAddr)) & 0xffff;
  }

  /** ADDR 8 + DATA 4 をパネル LED に反映。ADS 表示は砲弾 E/F */
  refreshLeds(): void {
    const addrSegs = wordToSegDigits(this.wordAddr, 8);
    const dataSegs = wordToSegDigits(this.dataWord, 4);
    const sevenSeg = new Uint8Array(12);
    sevenSeg.set(addrSegs, 0);
    sevenSeg.set(dataSegs, 8);
    // 砲弾 E=ADDR フォーカス, F=DATA フォーカス（ioboard: 入力切替用 2LED）
    let bullet8_F = 0;
    if (this.focus === "addr") bullet8_F |= 1 << 6; // E
    else bullet8_F |= 1 << 7; // F
    if (this.halted) bullet8_F |= 1 << 5; // D = HALT 表示（任意）
    applyLedDisplayCommand({
      sevenSeg,
      bulletLed0_7: 0,
      bulletLed8_F: bullet8_F,
    });
  }
}

/** ブリッジ実装が使うコマンド定数の再エクスポート */
export const CONSOLE_HSHK = {
  MEM_READ: CMD_IO_TO_CPU.MEM_READ,
  MEM_WRITE: CMD_IO_TO_CPU.MEM_WRITE,
  EXEC: CMD_IO_TO_CPU.EXEC,
} as const;
