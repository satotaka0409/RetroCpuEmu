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
  makeMemDumpRows,
  memFetchRange,
  MEM_WORDS_PER_ROW,
  PHYS_WORD_MASK,
} from "../panel/mockState";

/** 18bit 物理ワード空間のバイト数（256K ワード） */
export const MEM_BYTE_SIZE = 0x40000 * 2;

/** エントリ候補（大文字比較）。モニタは g_main を優先 */
export const ENTRY_LABELS = ["g_main", "gl_main", "main", "run"] as const;

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
   * エントリワードを決める（CDB の main/run 優先、なければ HEX 最小アドレス）。
   * @returns ワードアドレス
   */
  resolveEntryWord(): number {
    for (const name of ENTRY_LABELS) {
      const hit = [...this.cdb.byName.entries()].find(
        ([k]) => k.toLowerCase() === name.toLowerCase(),
      );
      if (hit) return hit[1]!.wordAddr & 0xffff;
    }
    if (this.hexInfo && this.hexInfo.bytesWritten > 0) {
      return (this.hexInfo.minAddr >>> 1) & 0xffff;
    }
    return 0;
  }

  /**
   * 画面用 DebugViewState を作る。
   * @param source ソース表示（省略時は空）
   * @returns 状態
   */
  toViewState(source?: {
    path: string;
    lines: string[];
    focusLine: number;
  }): DebugViewState {
    const base = createMockDebugState();
    const entry = this.entryWord & 0xffff;
    const disasm = this.buildDisasm(entry, 48);
    const win = memFetchRange(entry);
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
      sourcePath: source?.path ?? "(ソース未検出)",
      sourceLines: source?.lines ?? ["; ソースファイルが見つかりません"],
      sourceFocusLine: source?.focusLine ?? 1,
      disasm,
      memDump,
      memStart: entry & PHYS_WORD_MASK,
      memCacheLo: win.lo,
      memCacheHi: win.hi,
      memNote: "handshake 13h 取得待ち（retrocpu_emu が必要）",
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
   * エントリ周辺を逆アセンブルする。
   * @param start 開始ワード
   * @param maxLines 最大行数
   * @returns 行配列
   */
  private buildDisasm(start: number, maxLines: number): DisasmLine[] {
    const dis = new Mn1613Disassembler();
    for (const s of this.cdb.symbols) {
      dis.addLabel(s.name, s.wordAddr);
    }

    const labelAt = new Map<number, string>();
    for (const s of this.cdb.symbols) {
      if (!labelAt.has(s.wordAddr & 0xffff) || s.scope === "G") {
        labelAt.set(s.wordAddr & 0xffff, s.name);
      }
    }

    const lines: DisasmLine[] = [];
    let addr = start & 0xffff;
    for (let i = 0; i < maxLines; i += 1) {
      const r = dis.disassemble(addr, this.readWord);
      const words: string[] = [];
      for (let w = 0; w < r.wordCount; w += 1) {
        words.push(hex4(this.readWord(addr + w)));
      }
      const label = labelAt.get(addr);
      lines.push({
        addr: hex4(addr),
        bytes: words.join(" "),
        text: label ? `${r.text}  ; ${label}` : r.text,
        current: i === 0,
      });
      const next = r.nextAddr;
      if (next === addr) break;
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
 * エントリラベル名を返す（見つかれば）。
 * @param session セッション
 * @returns ラベル名。無ければ undefined
 */
export function entryLabelName(session: ProgramSession): string | undefined {
  for (const name of ENTRY_LABELS) {
    const hit = [...session.cdb.byName.entries()].find(
      ([k]) => k.toLowerCase() === name.toLowerCase(),
    );
    if (hit) return hit[0];
  }
  return undefined;
}
