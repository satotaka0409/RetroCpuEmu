/** LCD1602 の列数（16桁） */
export const LCD_COLS = 16;
/** LCD1602 の行数（2行） */
export const LCD_ROWS = 2;

/** LCD 操作の応答コード（HandShake.mdc 準拠） */
export const LCD_RESPONSE = {
  OK: 0x00,
  NG: 0x01,
  NG_OTHER: 0x02,
} as const;

/**
 * レンダラ表示やスナップショット転送に使う LCD 状態。
 */
export type LcdConsoleWire = {
  /** 桁数（固定 16） */
  cols: number;
  /** 行数（固定 2） */
  rows: number;
  /** 2行分の表示文字列（各16文字） */
  lines: [string, string];
  /** カーソル行（0 or 1） */
  cursorRow: number;
  /** カーソル列（0..15） */
  cursorCol: number;
  /** 表示ON/OFF */
  displayOn: boolean;
  /** カーソル表示ON/OFF */
  cursorOn: boolean;
  /** カーソル点滅ON/OFF */
  blinkOn: boolean;
};

/**
 * LCD1602 互換の最小エミュレータ。
 * - 17h: LCD制御（Clear/Home/DisplayCtrl/SetCursor）
 * - 18h: LCD文字列表示（行・列・長さ・ASCII列）
 */
export class LcdConsoleEmulator {
  /** 表示不可能文字を置き換える空白コード */
  private static readonly SPACE = 0x20;

  /** 2x16 の表示RAM（行優先） */
  private readonly ddram = new Uint8Array(LCD_COLS * LCD_ROWS);
  private cursorRow = 0;
  private cursorCol = 0;
  private displayOn = true;
  private cursorOn = false;
  private blinkOn = false;

  constructor() {
    this.reset();
  }

  /**
   * 電源投入相当の初期状態へ戻す。
   */
  reset(): void {
    this.ddram.fill(LcdConsoleEmulator.SPACE);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.displayOn = true;
    this.cursorOn = false;
    this.blinkOn = false;
  }

  /**
   * 表示を全消去し、カーソルを先頭へ戻す。
   */
  clear(): void {
    this.ddram.fill(LcdConsoleEmulator.SPACE);
    this.cursorRow = 0;
    this.cursorCol = 0;
  }

  /**
   * カーソルをホーム位置（0,0）へ戻す。
   */
  home(): void {
    this.cursorRow = 0;
    this.cursorCol = 0;
  }

  /**
   * 表示制御ビットを適用する。
   * - bit0: displayOn
   * - bit1: cursorOn
   * - bit2: blinkOn
   */
  setDisplayControl(bits: number): void {
    this.displayOn = (bits & 0x01) !== 0;
    this.cursorOn = (bits & 0x02) !== 0;
    this.blinkOn = (bits & 0x04) !== 0;
  }

  /**
   * カーソル位置を設定する。
   * @returns 範囲外が指定された場合は false
   */
  setCursor(row: number, col: number): boolean {
    if (!this.isValidRow(row) || !this.isValidCol(col)) return false;
    this.cursorRow = row;
    this.cursorCol = col;
    return true;
  }

  /**
   * 指定位置から文字列を書き込む（行末で打ち切り）。
   * @returns row/col が範囲外の場合は false
   */
  writeText(row: number, col: number, text: string): boolean {
    if (!this.isValidRow(row) || !this.isValidCol(col)) return false;
    let c = col;
    for (let i = 0; i < text.length && c < LCD_COLS; i++, c++) {
      this.ddram[this.indexOf(row, c)] = this.normalizeAscii(
        text.charCodeAt(i),
      );
    }
    this.cursorRow = row;
    this.cursorCol = Math.min(c, LCD_COLS - 1);
    return true;
  }

  /**
   * HandShake.mdc の 17h（LCD制御）を処理する。
   * frame = [cmd(17h), kind, argA, argB, argC]
   * - kind=0: Clear
   * - kind=1: Home
   * - kind=2: DisplayCtrl（argA 使用）
   * - kind=3: SetCursor（argB=row, argC=col）
   */
  handleControlFrame(frame: Uint8Array): number {
    if (frame.length < 5) return LCD_RESPONSE.NG;
    const kind = frame[1] ?? 0;
    const argA = frame[2] ?? 0;
    const argB = frame[3] ?? 0;
    const argC = frame[4] ?? 0;

    switch (kind) {
      case 0: // Clear
        this.clear();
        return LCD_RESPONSE.OK;
      case 1: // Home
        this.home();
        return LCD_RESPONSE.OK;
      case 2: // DisplayCtrl
        this.setDisplayControl(argA);
        return LCD_RESPONSE.OK;
      case 3: // SetCursor
        return this.setCursor(argB, argC) ? LCD_RESPONSE.OK : LCD_RESPONSE.NG;
      default:
        return LCD_RESPONSE.NG;
    }
  }

  /**
   * HandShake.mdc の 18h（LCD文字列表示）を処理する。
   * frame = [cmd(18h), row, col, len, ch0..ch15]
   * len は 0..16、有効データは行末までで打ち切る。
   */
  handleTextFrame(frame: Uint8Array): number {
    if (frame.length < 4) return LCD_RESPONSE.NG;
    const row = frame[1] ?? 0;
    const col = frame[2] ?? 0;
    const len = frame[3] ?? 0;
    if (!this.isValidRow(row) || !this.isValidCol(col)) return LCD_RESPONSE.NG;
    if (len < 0 || len > 16) return LCD_RESPONSE.NG;

    const maxWritable = Math.min(len, LCD_COLS - col);
    for (let i = 0; i < maxWritable; i++) {
      const code = frame[4 + i] ?? LcdConsoleEmulator.SPACE;
      this.ddram[this.indexOf(row, col + i)] = this.normalizeAscii(code);
    }

    this.cursorRow = row;
    this.cursorCol = Math.min(col + maxWritable, LCD_COLS - 1);
    return LCD_RESPONSE.OK;
  }

  /**
   * 現在表示状態をスナップショット形式で返す。
   */
  snapshot(): LcdConsoleWire {
    const line0 = this.readLine(0);
    const line1 = this.readLine(1);
    return {
      cols: LCD_COLS,
      rows: LCD_ROWS,
      lines: [line0, line1],
      cursorRow: this.cursorRow,
      cursorCol: this.cursorCol,
      displayOn: this.displayOn,
      cursorOn: this.cursorOn,
      blinkOn: this.blinkOn,
    };
  }

  /**
   * 指定行（0/1）を16文字の文字列に変換する。
   */
  private readLine(row: 0 | 1): string {
    let out = "";
    for (let col = 0; col < LCD_COLS; col++) {
      const code =
        this.ddram[this.indexOf(row, col)] ?? LcdConsoleEmulator.SPACE;
      out += String.fromCharCode(this.normalizeAscii(code));
    }
    return out;
  }

  /**
   * 行・列を内部配列インデックスへ変換する。
   */
  private indexOf(row: number, col: number): number {
    return row * LCD_COLS + col;
  }

  /**
   * 行番号の妥当性を判定する。
   */
  private isValidRow(row: number): row is 0 | 1 {
    return row === 0 || row === 1;
  }

  /**
   * 列番号の妥当性を判定する。
   */
  private isValidCol(col: number): boolean {
    return Number.isInteger(col) && col >= 0 && col < LCD_COLS;
  }

  /**
   * 表示可能 ASCII（0x20..0x7E）以外は空白へ丸める。
   */
  private normalizeAscii(code: number): number {
    const v = code & 0xff;
    if (v < 0x20 || v > 0x7e) return LcdConsoleEmulator.SPACE;
    return v;
  }
}

/** IO ボード共有の LCD1602（17h/18h と画面スナップショット） */
export const lcdConsole = new LcdConsoleEmulator();

/**
 * 空欄の LCD スナップショットを返す。
 * @returns 16x2 空白・表示ON・カーソルOFF
 */
export function emptyLcdWire(): LcdConsoleWire {
  return {
    cols: LCD_COLS,
    rows: LCD_ROWS,
    lines: [" ".repeat(LCD_COLS), " ".repeat(LCD_COLS)],
    cursorRow: 0,
    cursorCol: 0,
    displayOn: true,
    cursorOn: false,
    blinkOn: false,
  };
}

/**
 * 現在の LCD 状態をスナップショット用に返す。
 * @returns 呼び出し側で書き換えても本体に影響しないコピー
 */
export function getLcdWire(): LcdConsoleWire {
  return lcdConsole.snapshot();
}

/** 電源投入／RST 相当に LCD を戻す */
export function resetLcdConsole(): void {
  lcdConsole.reset();
}
