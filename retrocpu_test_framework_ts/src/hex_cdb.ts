/**
 * Intel HEX / SDCC CDB の生成
 * 根拠: test_framework.mdc / emulater_code_test.mdc
 */

/**
 * 1 レコードのチェックサム（2 の補数）。
 * @param bytes 長さ・アドレス・種別・データを含むレコード本体
 * @returns 0–255
 */
function checksum(bytes: number[]): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return (~sum + 1) & 0xff;
}

/**
 * リンク済みバイトイメージを Intel HEX テキストにする。
 * 全ゼロの 16 バイト塊は省略する（ロード先は事前ゼロクリア前提）。
 * @param image ビッグエンディアン・先頭＝バイト 0
 * @returns IHX 全文（EOF 付き）
 */
export function imageToIntelHex(image: Uint8Array): string {
  const lines: string[] = [];
  for (let addr = 0; addr < image.length; addr += 16) {
    const chunk = image.subarray(addr, Math.min(addr + 16, image.length));
    if (chunk.every((b) => b === 0)) {
      continue;
    }
    const rec = [
      chunk.length,
      (addr >> 8) & 0xff,
      addr & 0xff,
      0,
      ...chunk,
    ];
    rec.push(checksum(rec));
    lines.push(
      `:${rec.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")}`,
    );
  }
  lines.push(":00000001FF");
  return `${lines.join("\n")}\n`;
}

/**
 * sdld マップ（または同等の名前→バイトアドレス表）を SDCC CDB の L:G にする。
 * 製品リンクは sdld 本体と `defsToCdbFromSdld`（retrocpu_asm）が担う。
 * ここはマップフォールバック／単体テスト用。`__CP$` はチェックポイント側へ。
 * @param defs シンボル名 → バイトアドレス
 * @returns CDB テキスト
 */
export function defsToCdb(defs: Map<string, number>): string {
  const names = [...defs.keys()]
    .filter((n) => !/^__CP[0-9]{4}$/i.test(n) && !/^__CP\$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const name of names) {
    const byteAddr = defs.get(name)! >>> 0;
    const hex = byteAddr.toString(16).toUpperCase();
    lines.push(`L:G$${name}$0$0:${hex}`);
  }
  return `${lines.join("\n")}\n`;
}
