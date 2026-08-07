/**
 * Intel HEX パーサ／ローダ
 * 根拠: .cursor/rules/emulater_code_test.mdc
 *
 * アドレス欄はバイトアドレス（バッファオフセット）。
 */

export type IntelHexLoadResult = {
  /** 書き込んだバイト数 */
  bytesWritten: number;
  /** 出現した最小／最大バイトアドレス（データレコード） */
  minAddr: number;
  maxAddr: number;
};

/**
 * レコードのチェックサムを検証する。
 * @param bytes チェックサムを含むレコード全バイト
 * @returns 総和の下位 8bit が 0 なら true
 */
function checksumOk(bytes: number[]): boolean {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum === 0;
}

/**
 * Intel HEX テキストを DataView（または Uint8Array 互換バッファ）へロードする。
 * @param hexText - HEX 全文
 * @param mem - 書き込み先（バイトアドレス = オフセット）
 */
export function loadIntelHex(
  hexText: string,
  mem: DataView | Uint8Array,
): IntelHexLoadResult {
  /**
   * バッファへ 1 バイト書く。
   * @param addr バイトアドレス
   * @param v 書き込む値
   * @throws バッファ範囲外の場合
   */
  const writeByte = (addr: number, v: number): void => {
    if (addr < 0 || addr >= mem.byteLength) {
      throw new Error(`Intel HEX address out of range: 0x${addr.toString(16)}`);
    }
    if (mem instanceof DataView) mem.setUint8(addr, v & 0xff);
    else mem[addr] = v & 0xff;
  };

  let bytesWritten = 0;
  let minAddr = Number.POSITIVE_INFINITY;
  let maxAddr = -1;
  let base = 0; // extended linear / segment（簡易）
  let sawEof = false;

  const lines = hexText.replace(/\r\n/g, "\n").split("\n");
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]!.trim();
    if (!raw) continue;
    if (!raw.startsWith(":")) {
      throw new Error(`Intel HEX line ${li + 1}: missing ':'`);
    }
    const hex = raw.slice(1);
    if (hex.length < 10 || hex.length % 2 !== 0) {
      throw new Error(`Intel HEX line ${li + 1}: bad length`);
    }
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    if (!checksumOk(bytes)) {
      throw new Error(`Intel HEX line ${li + 1}: checksum error`);
    }
    const count = bytes[0]!;
    const addr = (bytes[1]! << 8) | bytes[2]!;
    const type = bytes[3]!;
    const data = bytes.slice(4, 4 + count);

    if (type === 0x00) {
      const abs = (base + addr) >>> 0;
      for (let i = 0; i < data.length; i++) {
        const a = abs + i;
        writeByte(a, data[i]!);
        bytesWritten++;
        if (a < minAddr) minAddr = a;
        if (a > maxAddr) maxAddr = a;
      }
    } else if (type === 0x01) {
      sawEof = true;
      break;
    } else if (type === 0x02) {
      // extended segment address (addr * 16)
      if (data.length !== 2) throw new Error(`Intel HEX line ${li + 1}: type 02`);
      base = ((data[0]! << 8) | data[1]!) << 4;
    } else if (type === 0x04) {
      // extended linear address
      if (data.length !== 2) throw new Error(`Intel HEX line ${li + 1}: type 04`);
      base = ((data[0]! << 8) | data[1]!) << 16;
    } else {
      // 03/05 等は無視（エントリポイント）
    }
  }

  if (!sawEof) {
    throw new Error("Intel HEX: missing EOF record (type 01)");
  }
  if (bytesWritten === 0) {
    minAddr = 0;
    maxAddr = -1;
  }
  return { bytesWritten, minAddr, maxAddr };
}

/**
 * ワード列（ビッグエンディアン）から最小 Intel HEX テキストを生成（テスト用）。
 * @param wordAddr - 開始ワードアドレス
 * @param words - 16bit ワード列
 */
export function wordsToIntelHex(wordAddr: number, words: number[]): string {
  const byteAddr = (wordAddr & 0xffff) * 2;
  const payload: number[] = [];
  for (const w of words) {
    payload.push((w >>> 8) & 0xff, w & 0xff);
  }
  const lines: string[] = [];
  let off = 0;
  while (off < payload.length) {
    const chunk = payload.slice(off, off + 16);
    const addr = byteAddr + off;
    const rec: number[] = [chunk.length, (addr >>> 8) & 0xff, addr & 0xff, 0x00, ...chunk];
    let sum = 0;
    for (const b of rec) sum = (sum + b) & 0xff;
    rec.push((0x100 - sum) & 0xff);
    lines.push(":" + rec.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""));
    off += chunk.length;
  }
  lines.push(":00000001FF");
  return lines.join("\n") + "\n";
}
