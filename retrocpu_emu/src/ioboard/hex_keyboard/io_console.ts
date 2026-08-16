/**
 * IO ボード前面パネル（ioboard.mdc ファンクションキー）
 *
 * キーボードからのメモリ R/W はハンドシェイク（13h/14h）。
 * 実行は 12h。表示はパネル自身が 7セグを駆動（モニタは 0x16 を使わない）。
 */

import { wordToSegDigits, wordToSegDigitsPadded } from "../seven_led/seg_font";
import {
  OFFSETS,
  alignAddrToStep,
  normalizeAddrStep,
} from "../setting_area";
import { applyLedDisplayCommand } from "../seven_led/io_led";
import {
  applyUndefLedCommand,
  getUndefLed,
  resetUndefLed,
} from "../bullet_led/io_undef_led";
import { CMD_IO_TO_CPU } from "../../shared/board_link";
import { FN_KEY_LABELS } from "../../shared/fn_keys";
import { getLogger } from "../../log/logger";

const log = getLogger("panel");
const SEG_DASH = 0x40;

export type ConsoleFocus = "addr" | "data";
export type ConsoleMode = "monitor" | "setting_area";

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
  /** ハンドシェイク MEM_READ (0x13): ワードアドレスから 1 ワード読む */
  memReadWord(wordAddr: number): Promise<number>;
  /** ハンドシェイク MEM_WRITE (0x14): 1 ワード書く */
  memWriteWord(wordAddr: number, word: number): Promise<void>;
  /** 設定エリア（00h-FFh）から 1 バイト読む */
  readSettingByte(byteAddr: number): Promise<number>;
  /** 設定エリア（00h-FFh）へ 1 バイト書く */
  writeSettingByte(byteAddr: number, value: number): Promise<void>;
  /** ハンドシェイク EXEC (0x12) */
  exec(wordAddr: number): Promise<void>;
  setHalt(halt: boolean): Promise<void>;
  /** F7 RST: HALT → ブートモニタ DMA → CPU RST パルス */
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
  mode: ConsoleMode;
  halted: boolean;
  /** 未定義命令検出（IISR ビット15=LSB 0x0001 / 砲弾 B） */
  undefInsn: boolean;
};

export class IoConsole {
  private wordAddr = 0;
  private dataWord = 0;
  private focus: ConsoleFocus = "addr";
  private mode: ConsoleMode = "monitor";
  private halted = true;
  /** モニター時のアドレス増加数（設定 05h。設定エリア編集中は常に 1） */
  private addrStep = 1;
  /** モニター時の ADDR 7セグ桁数（設定 0Ah、最大 8） */
  private addrDigits = 5;
  /** モニター時の DATA 7セグ桁数（設定 0Bh、最大 4） */
  private dataDigits = 4;

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
      mode: this.mode,
      halted: this.halted,
      undefInsn: getUndefLed(),
    };
  }

  /**
   * 1階 RST 後のパネル表示（ioboard.mdc）。
   * ADDR 入力・ADDR/DATA=0・UNDEF 消灯。ブートモニタは H 待ちなので HALT。
   */
  notifyCpuReset(): void {
    this.wordAddr = 0;
    this.dataWord = 0;
    this.focus = "addr";
    this.mode = "monitor";
    resetUndefLed();
    this.halted = true;
    this.refreshLeds();
  }

  /** ADS 長押しで設定エリア編集モードへ入退する。 */
  onAdsLongPress(): void {
    this.mode = this.mode === "monitor" ? "setting_area" : "monitor";
    this.focus = "addr";
    this.wordAddr = 0;
    this.dataWord = 0;
    log.info("ADS 長押しでモード切替", { mode: this.mode });
    this.refreshLeds();
  }

  /**
   * ハンドシェイク 13h で UNDEF LED（砲弾 B）を明示設定する。
   * sticky: 消灯指示または RST まで点灯を維持する。
   * @param on true=点灯 / false=消灯
   */
  setUndefLed(on: boolean): void {
    const changed = on !== getUndefLed();
    applyUndefLedCommand(on);
    if (on) this.halted = true;
    if (changed && on) log.warn("未定義命令LED点灯（13h）");
    this.refreshLeds();
  }

  /** 16進キー 0–F */
  onHex(digit: string): void {
    const n = parseInt(digit, 16);
    if (Number.isNaN(n)) return;
    if (this.focus === "addr") {
      if (this.mode === "setting_area") {
        this.wordAddr = ((this.wordAddr << 4) | (n & 0xf)) & 0xff;
      } else {
        this.wordAddr = ((this.wordAddr << 4) | (n & 0xf)) >>> 0;
      }
    } else {
      if (this.mode === "setting_area") {
        this.dataWord = ((this.dataWord << 4) | (n & 0xf)) & 0xff;
      } else {
        this.dataWord = ((this.dataWord << 4) | (n & 0xf)) & 0xffff;
      }
    }
    log.debug("16進キー入力", {
      digit,
      focus: this.focus,
      mode: this.mode,
      addr: this.wordAddr,
      data: this.dataWord,
    });
    this.refreshLeds();
  }

  /**
   * ファンクションキーを処理する（ioboard.mdc の F0〜F7）。
   * メモリ R/W はハンドシェイク 13h/14h、実行は 12h を使う。
   * @param fn "F0"=ADS "F1"=CLR "F2"=INC "F3"=DEC "F4"=WINC "F5"=RUN "F6"=H/ST "F7"=RST
   */
  async onFunction(fn: ConsoleFnKey): Promise<void> {
    await this.syncFromSettings();
    log.info("ファンクションキー", {
      fn,
      key: FN_KEY_LABELS[fn],
      addr: this.wordAddr,
      data: this.dataWord,
    });
    switch (fn) {
      case "F0": // ADS
        this.focus = this.focus === "addr" ? "data" : "addr";
        if (this.focus === "data") {
          this.alignMonitorAddr();
          await this.readAt(this.wordAddr);
        }
        this.refreshLeds();
        break;
      case "F1": // CLR
        if (this.focus === "addr") this.wordAddr = 0;
        else this.dataWord = 0;
        this.refreshLeds();
        break;
      case "F2": // INC
        this.alignMonitorAddr();
        this.wordAddr = this.addAddr(this.addrDelta());
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F3": // DEC
        this.alignMonitorAddr();
        this.wordAddr = this.addAddr(-this.addrDelta());
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F4": // WINC
        this.alignMonitorAddr();
        if (this.mode === "setting_area") {
          await this.cpu.writeSettingByte(
            this.wordAddr & 0xff,
            this.dataWord & 0xff,
          );
        } else {
          await this.cpu.memWriteWord(this.wordAddr, this.dataWord);
        }
        this.wordAddr = this.addAddr(this.addrDelta());
        await this.readAt(this.wordAddr);
        this.focus = "data";
        this.refreshLeds();
        break;
      case "F5": // RUN
        this.alignMonitorAddr();
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
      case "F7": // RST: HALT → ブートモニタ DMA → CPU RST（bridge がフルリセット）
        await this.cpu.pulseReset();
        this.notifyCpuReset();
        break;
      default:
        break;
    }
  }

  /**
   * 設定エリアからモニター用の増加数・7セグ桁数を取り込む。
   */
  private async syncFromSettings(): Promise<void> {
    this.addrStep = normalizeAddrStep(
      await this.cpu.readSettingByte(OFFSETS.ADDR_STEP),
    );
    const addrDigits = await this.cpu.readSettingByte(
      OFFSETS.SEVEN_SEG_ADDR_DIGITS,
    );
    const dataDigits = await this.cpu.readSettingByte(
      OFFSETS.SEVEN_SEG_DATA_DIGITS,
    );
    this.addrDigits =
      addrDigits >= 1 && addrDigits <= 8 ? addrDigits : 5;
    this.dataDigits =
      dataDigits >= 1 && dataDigits <= 4 ? dataDigits : 4;
  }

  /**
   * モニター時、増加数 2 なら奇数アドレスを 1 減算する。
   */
  private alignMonitorAddr(): void {
    if (this.mode !== "monitor") return;
    this.wordAddr = alignAddrToStep(this.wordAddr, this.addrStep);
  }

  /**
   * INC/DEC/WINC の増減幅。設定エリア編集中は常に 1。
   * @returns 1 または 2
   */
  private addrDelta(): number {
    return this.mode === "setting_area" ? 1 : this.addrStep;
  }

  /**
   * アドレスに増減を加える（設定エリアは 8bit ラップ）。
   * @param delta 加算する値（負数可）
   * @returns 更新後アドレス
   */
  private addAddr(delta: number): number {
    if (this.mode === "setting_area") {
      return (this.wordAddr + delta) & 0xff;
    }
    return (this.wordAddr + delta) >>> 0;
  }

  /**
   * 指定アドレスを読んで DATA 表示用の値に取り込む。
   * @param wordAddr 読み出すワードアドレス
   */
  private async readAt(wordAddr: number): Promise<void> {
    if (this.mode === "setting_area") {
      this.dataWord = (await this.cpu.readSettingByte(wordAddr & 0xff)) & 0xff;
      return;
    }
    this.dataWord = (await this.cpu.memReadWord(wordAddr)) & 0xffff;
  }

  /** ADDR/DATA + ADS(E/F) + HALT(D)/RUN(C) + UNDEF(B) */
  refreshLeds(): void {
    const addrSegs =
      this.mode === "setting_area"
        ? [SEG_DASH, 0, 0, 0, 0, 0, ...wordToSegDigits(this.wordAddr & 0xff, 2)]
        : wordToSegDigitsPadded(this.wordAddr, this.addrDigits, 8);
    const dataSegs =
      this.mode === "setting_area"
        ? [0, 0, ...wordToSegDigits(this.dataWord & 0xff, 2)]
        : wordToSegDigitsPadded(this.dataWord, this.dataDigits, 4);
    const sevenSeg = new Uint8Array(12);
    sevenSeg.set(addrSegs, 0);
    sevenSeg.set(dataSegs, 8);
    let bullet8_F = 0;
    if (this.focus === "addr")
      bullet8_F |= 1 << 6; // E
    else bullet8_F |= 1 << 7; // F
    if (this.halted)
      bullet8_F |= 1 << 5; // D = HALT
    else bullet8_F |= 1 << 4; // C = RUN
    if (getUndefLed()) bullet8_F |= 1 << 3; // B = UNDEF
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
