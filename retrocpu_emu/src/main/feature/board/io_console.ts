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
import { getLogger } from "../log/logger";

const log = getLogger("panel");

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
  /** 未定義命令検出（IISR bit15 / 砲弾 B） */
  undefInsn: boolean;
};

export class IoConsole {
  private wordAddr = 0;
  private dataWord = 0;
  private focus: ConsoleFocus = "addr";
  private halted = true;
  private undefInsn = false;

  /**
   * @param cpu CPU ボードへのハンドシェイク／制御ブリッジ
   */
  constructor(private readonly cpu: ConsoleCpuBridge) {
    this.refreshLeds();
  }

  /**
   * パネルの現在状態を返す（スナップショット用）。
   * @returns アドレス／データ／入力フォーカス／HALT／未定義命令フラグ
   */
  getState(): IoConsoleState {
    return {
      wordAddr: this.wordAddr >>> 0,
      dataWord: this.dataWord & 0xffff,
      focus: this.focus,
      halted: this.halted,
      undefInsn: this.undefInsn,
    };
  }

  /**
   * CPU ミラー（IISR 等）をパネルに反映。
   * 未定義命令: IISR bit15 → 砲弾 B (UNDEF)。検出時は HALT 表示も合わせる。
   */
  syncFromCpu(iisr: number): void {
    const undef = (iisr & 0x8000) !== 0;
    if (undef === this.undefInsn) return;
    this.undefInsn = undef;
    if (undef) this.halted = true;
    if (undef) log.warn("未定義命令検出（UNDEF 点灯）", { iisr });
    this.refreshLeds();
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
    log.debug("16進キー入力", {
      digit,
      focus: this.focus,
      addr: this.wordAddr,
      data: this.dataWord,
    });
    this.refreshLeds();
  }

  /**
   * ファンクションキーを処理する（ioboard.mdc の F0〜F7）。
   * メモリ R/W はハンドシェイク 50h/51h、実行は 49h を使う。
   * @param fn "F0"=ADS "F1"=RD "F2"=INC "F3"=DEC "F4"=WINC "F5"=RUN "F6"=H/ST "F7"=RST
   */
  async onFunction(fn: ConsoleFnKey): Promise<void> {
    log.info("ファンクションキー", {
      fn,
      key: FN_KEY_LABELS[fn],
      addr: this.wordAddr,
      data: this.dataWord,
    });
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
      case "F6": // H/ST（パネル状態でトグル。isHalted は即時反映されない／H 即停止でも RUN 表示と食い違う）
        if (this.halted) {
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

  /**
   * 指定アドレスを読んで DATA 表示用の値に取り込む。
   * @param wordAddr 読み出すワードアドレス
   */
  private async readAt(wordAddr: number): Promise<void> {
    this.dataWord = (await this.cpu.memReadWord(wordAddr)) & 0xffff;
  }

  /** ADDR/DATA + ADS(E/F) + HALT(D)/RUN(C) + UNDEF(B) */
  refreshLeds(): void {
    const addrSegs = wordToSegDigits(this.wordAddr, 8);
    const dataSegs = wordToSegDigits(this.dataWord, 4);
    const sevenSeg = new Uint8Array(12);
    sevenSeg.set(addrSegs, 0);
    sevenSeg.set(dataSegs, 8);
    let bullet8_F = 0;
    if (this.focus === "addr") bullet8_F |= 1 << 6; // E
    else bullet8_F |= 1 << 7; // F
    if (this.halted) bullet8_F |= 1 << 5; // D = HALT
    else bullet8_F |= 1 << 4; // C = RUN
    if (this.undefInsn) bullet8_F |= 1 << 3; // B = UNDEF
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
