/**
 * テスト用ワードヒープ（ユーザ領域の malloc / free）
 * 根拠: test_framework.mdc / MN1613_CPUボードメモリ_IOマップ.mdc
 */

/** ユーザ領域先頭（ワード）。モニタ ROM/RAM・戻りスタブの直後 */
export const MN1613_USER_HEAP_START = 0x1800;

/** スタック領域先頭（ワード、排他）。ヒープはここより下 */
export const MN1613_USER_HEAP_END = 0xf800;

/** JsonTestSettings.malloc / セッションヒープ範囲 */
export type MallocSettings = {
  /** 先頭ワードアドレス。省略時 0x1800 */
  start?: number;
  /** 使用ワード数。省略時 start から 0xF800 まで */
  words?: number;
};

/**
 * 設定の malloc.start / malloc.words からヒープ範囲を求める。
 * @param malloc 設定。省略時はユーザ領域全体
 * @returns startWord（含む）と endWord（含まない）
 */
export function resolveMallocRange(malloc?: MallocSettings): {
  startWord: number;
  endWord: number;
  words: number;
} {
  const start = malloc?.start ?? MN1613_USER_HEAP_START;
  if (!Number.isInteger(start) || start < 0 || start > 0xffff) {
    throw new Error(`malloc.start: invalid word address ${start}`);
  }
  const words = malloc?.words ?? MN1613_USER_HEAP_END - start;
  if (!Number.isInteger(words) || words < 1) {
    throw new Error(`malloc.words: must be >= 1, got ${words}`);
  }
  const endWord = start + words;
  if (endWord > 0x10000) {
    throw new Error(
      `malloc: start 0x${hex4(start)} + words ${words} exceeds 16bit space`,
    );
  }
  return { startWord: start, endWord, words };
}

type HeapSpan = {
  start: number;
  size: number;
  used: boolean;
};

/**
 * 16bit ワードアドレスを 4 桁大文字 16 進にする。
 * @param n ワードアドレス
 * @returns 例 "1800"
 */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * ワード単位の first-fit ヒープ。エミュメモリとは独立（アドレス帳のみ）。
 */
export class WordHeap {
  private readonly lo: number;
  private readonly hi: number;
  private spans: HeapSpan[] = [];

  /**
   * @param startWord 先頭ワード（含む）
   * @param endWord 末尾ワード（含まない）
   */
  constructor(
    startWord = MN1613_USER_HEAP_START,
    endWord = MN1613_USER_HEAP_END,
  ) {
    if (!Number.isInteger(startWord) || startWord < 0 || startWord > 0xffff) {
      throw new Error(`WordHeap: invalid start ${startWord}`);
    }
    if (
      !Number.isInteger(endWord) ||
      endWord <= startWord ||
      endWord > 0x10000
    ) {
      throw new Error(
        `WordHeap: end ${endWord} must be > start ${startWord} and <= 0x10000`,
      );
    }
    this.lo = startWord;
    this.hi = endWord;
    this.reset();
  }

  /** ヒープ先頭（含む） */
  get startWord(): number {
    return this.lo;
  }

  /** ヒープ末尾（含まない） */
  get endWord(): number {
    return this.hi;
  }

  /** 1 本の空き領域に戻す */
  reset(): void {
    this.spans = [{ start: this.lo, size: this.hi - this.lo, used: false }];
  }

  /**
   * 連続ワードを確保する。
   * @param wordCount ワード数（1 以上）
   * @returns 先頭ワードアドレス
   * @throws 0 以下、または空き不足
   */
  malloc(wordCount: number): number {
    if (!Number.isInteger(wordCount) || wordCount < 1) {
      throw new Error(`malloc: wordCount must be >= 1, got ${wordCount}`);
    }
    for (let i = 0; i < this.spans.length; i += 1) {
      const span = this.spans[i]!;
      if (span.used || span.size < wordCount) {
        continue;
      }
      if (span.size === wordCount) {
        span.used = true;
        return span.start;
      }
      this.spans.splice(
        i,
        1,
        { start: span.start, size: wordCount, used: true },
        { start: span.start + wordCount, size: span.size - wordCount, used: false },
      );
      return span.start;
    }
    throw new Error(
      `malloc: out of heap (${wordCount} words, 0x${hex4(this.lo)}–0x${hex4(this.hi)})`,
    );
  }

  /**
   * malloc で得た先頭アドレスを解放する。
   * @param wordAddr malloc の戻り値
   * @throws 未確保アドレス・二重解放
   */
  free(wordAddr: number): void {
    const addr = wordAddr & 0xffff;
    const i = this.spans.findIndex((s) => s.start === addr && s.used);
    if (i < 0) {
      throw new Error(`free: not an allocated block: 0x${hex4(addr)}`);
    }
    this.spans[i]!.used = false;
    this.coalesce();
  }

  /**
   * 確保中ブロックのワード数。
   * @param wordAddr malloc の戻り値
   * @returns ワード数
   */
  sizeOf(wordAddr: number): number {
    const addr = wordAddr & 0xffff;
    const span = this.spans.find((s) => s.start === addr && s.used);
    if (!span) {
      throw new Error(`sizeOf: not an allocated block: 0x${hex4(addr)}`);
    }
    return span.size;
  }

  /**
   * 確保中ブロックか。
   * @param wordAddr 先頭ワード
   * @returns 確保中なら true
   */
  isAllocated(wordAddr: number): boolean {
    const addr = wordAddr & 0xffff;
    return this.spans.some((s) => s.start === addr && s.used);
  }

  /** 隣接する空きを結合する */
  private coalesce(): void {
    const out: HeapSpan[] = [];
    for (const span of this.spans) {
      const last = out[out.length - 1];
      if (last && !last.used && !span.used) {
        last.size += span.size;
      } else {
        out.push({ start: span.start, size: span.size, used: span.used });
      }
    }
    this.spans = out;
  }
}
