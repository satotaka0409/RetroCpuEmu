/**
 * 読み込んだプログラム（HEX メモリ + CDB）から画面状態を組み立てる。
 * 根拠: retrocpu_debug.mdc「プログラム読み込み」
 */

import { Mn1613Disassembler } from "../disasm/mn1613";
import type { CdbTable } from "./cdb";
import { emptyCdbTable, parseCdb } from "./cdb";
import { loadIntelHex, type IntelHexLoadResult } from "./intelHex";
import type {
  DebugViewState,
  DisasmLine,
  MemDumpRow,
  RegisterSnapshot,
} from "../panel/mockState";
import {
  createMockDebugState,
  hex4,
  hex5,
  makeMemDumpRows,
  memFetchRange,
  MEM_WORDS_PER_ROW,
  PHYS_WORD_MASK,
} from "../panel/mockState";

/** 18bit 物理ワード空間のバイト数（256K ワード） */
export const MEM_BYTE_SIZE = 0x40000 * 2;

/** 逆アセンブル先頭に使うラベル（大文字小文字不問） */
export const ENTRY_LABEL = "g_main";

/**
 * 読み込み結果のセッション。
 */
export class ProgramSession {
  readonly memory: Uint8Array;
  hexInfo: IntelHexLoadResult | null = null;
  cdb: CdbTable = emptyCdbTable();
  hexPath = "";
  cdbPath = "";
  entryWord = 0;

  /**
   * @param byteSize メモリバイト数（既定 512KiB = 256K ワード）
   */
  constructor(byteSize = MEM_BYTE_SIZE) {
    this.memory = new Uint8Array(byteSize);
  }

  /**
   * Intel HEX をメモリへ展開する。
   * @param hexText HEX 全文
   * @param hexPath 表示用パス
   * @returns ロード結果
   */
  loadHex(hexText: string, hexPath = ""): IntelHexLoadResult {
    this.memory.fill(0);
    this.hexInfo = loadIntelHex(hexText, this.memory);
    this.hexPath = hexPath;
    this.entryWord = this.resolveEntryWord();
    return this.hexInfo;
  }

  /**
   * CDB を取り込む。
   * @param cdbText CDB 全文
   * @param cdbPath 表示用パス
   */
  loadCdb(cdbText: string, cdbPath = ""): void {
    this.cdb = parseCdb(cdbText);
    this.cdbPath = cdbPath;
    this.entryWord = this.resolveEntryWord();
  }

  /**
   * 物理ワードアドレスの 16bit 値を読む（ビッグエンディアン）。
   * @param wordAddr 物理ワード（18bit）
   * @returns 16bit
   */
  readWord = (wordAddr: number): number => {
    const a = (wordAddr & PHYS_WORD_MASK) * 2;
    if (a + 1 >= this.memory.length) return 0;
    return ((this.memory[a]! << 8) | this.memory[a + 1]!) & 0xffff;
  };

  /**
   * 逆アセンブル先頭を決める。CDB に `g_main` があればそのワード、なければ HEX 最小アドレス。
   * @returns 物理ワードアドレス
   */
  resolveEntryWord(): number {
    const gMain = findGMainWord(this.cdb);
    if (gMain !== undefined) return gMain;
    if (this.hexInfo && this.hexInfo.bytesWritten > 0) {
      return (this.hexInfo.minAddr >>> 1) & PHYS_WORD_MASK;
    }
    return 0;
  }

  /**
   * 画面用 DebugViewState を作る（逆アセンブルのみ。ソース欄は出さない）。
   * @returns 状態
   */
  toViewState(): DebugViewState {
    const base = createMockDebugState();
    const entry = this.entryWord & PHYS_WORD_MASK;
    const win = memFetchRange(entry);
    const disasm = this.buildDisasm(entry, win.wordCount, win.hi, entry);
    const memDump = makeMemDumpRows(
      win.lo,
      Math.ceil(win.wordCount / MEM_WORDS_PER_ROW),
      () => 0,
    );
    const ic = hex4(entry);
    const current: RegisterSnapshot = {
      ...base.current,
      IC: ic,
      time: "0",
      stack: base.current.stack.map(() => "0000"),
    };
    const baseName = this.hexPath ? basename(this.hexPath) : "loaded.hex";
    return {
      ...base,
      title: `MN1613 Debug — ${baseName}`,
      disasm,
      memDump,
      memStart: entry & PHYS_WORD_MASK,
      memCacheLo: win.lo,
      memCacheHi: win.hi,
      memNote: "handshake 83h 取得待ち（retrocpu_emu が必要）",
      disasmStart: entry & PHYS_WORD_MASK,
      disasmCacheLo: win.lo,
      disasmCacheHi: win.hi,
      current,
      slotHistory: [],
      viewMode: "current",
      histIndex: 0,
      pointSlot: 0,
      bpSlots: base.bpSlots.map((b) => ({
        ...b,
        enabled: false,
        addr: "-----",
        access: "-",
        history: false,
      })),
    };
  }

  /**
   * バイト列をメモリへ重ね書きする（ハンドシェイク 83h の窓）。
   * @param byteAddr 先頭バイトアドレス
   * @param data ビッグエンディアン
   */
  patchBytes(byteAddr: number, data: Uint8Array): void {
    const start = byteAddr >>> 0;
    for (let i = 0; i < data.length; i += 1) {
      const a = start + i;
      if (a < this.memory.length) this.memory[a] = data[i]!;
    }
  }

  /**
   * 指定範囲を逆アセンブルする。
   * グローバルラベルがある番地は `label` に名前を載せる（オペランドも同様）。
   * @param start 開始ワード
   * @param maxLines 最大行数
   * @param endWord このワードを超えたら終了（省略時は maxLines のみ）
   * @param currentWord `current` を付けるワード（省略時は先頭行）
   * @returns 行配列
   */
  buildDisasm(
    start: number,
    maxLines: number,
    endWord?: number,
    currentWord?: number,
  ): DisasmLine[] {
    const dis = new Mn1613Disassembler();
    for (const s of this.cdb.symbols) {
      dis.addLabel(s.name, s.wordAddr, s.scope);
    }

    const end =
      endWord === undefined ? PHYS_WORD_MASK : endWord & PHYS_WORD_MASK;
    const cur =
      currentWord === undefined
        ? start & PHYS_WORD_MASK
        : currentWord & PHYS_WORD_MASK;
    const lines: DisasmLine[] = [];
    let addr = start & PHYS_WORD_MASK;
    for (let i = 0; i < maxLines; i += 1) {
      if (addr > end) break;
      const r = dis.disassemble(addr, this.readWord);
      const words: string[] = [];
      for (let w = 0; w < r.wordCount; w += 1) {
        words.push(hex4(this.readWord(addr + w)));
      }
      const gName = dis.globalLabelAt(addr);
      lines.push({
        addr: hex5(addr),
        ...(gName ? { label: gName } : {}),
        bytes: words.join(" "),
        text: r.text,
        current: addr === cur,
      });
      const next = r.nextAddr;
      if (next === addr) break;
      if (next > end && next > addr) break;
      addr = next;
    }
    return lines;
  }

  /**
   * メモリダンプ行を作る。
   * @param startWord 開始物理ワード
   * @param rows 行数（1 行 16 ワード）
   * @returns ダンプ
   */
  buildMemDump(startWord: number, rows: number): MemDumpRow[] {
    return makeMemDumpRows(startWord, rows, this.readWord);
  }
}

/**
 * パス末尾。
 * @param p パス
 * @returns ファイル名
 */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * CDB から `g_main` の物理ワードアドレスを取る。
 * @param cdb シンボル表
 * @returns ワードアドレス。無ければ undefined
 */
export function findGMainWord(cdb: CdbTable): number | undefined {
  const hit = [...cdb.byName.entries()].find(
    ([k]) => k.toLowerCase() === ENTRY_LABEL,
  );
  if (!hit) return undefined;
  return hit[1]!.wordAddr & PHYS_WORD_MASK;
}

/**
 * `g_main` があればその名前を返す。
 * @param session セッション
 * @returns ラベル名。無ければ undefined
 */
export function entryLabelName(session: ProgramSession): string | undefined {
  const hit = [...session.cdb.byName.entries()].find(
    ([k]) => k.toLowerCase() === ENTRY_LABEL,
  );
  return hit?.[0];
}
