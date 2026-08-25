/**
 * MN1613 逆アセンブラ
 * 根拠: MN1613.mdc / asm-rules.mdc / asm_test_framework.mdc
 */

import { decodeMn1613 } from "./decode";
import { formatDecoded } from "./format";
import { Mn1613LabelTable } from "./labels";
import type {
  Mn1613DisassembleResult,
  Mn1613DisassemblerOptions,
  Mn1613LabelPair,
  Mn1613ReadWord,
} from "./types";

/**
 * アドレスを与えると 1 命令を逆アセンブルする。
 * 初期化で CDB またはラベル:アドレスペアを渡すと、オペランドがラベルになる。
 */
export class Mn1613Disassembler {
  private readonly labels = new Mn1613LabelTable();

  /**
   * @param options CDB テキストおよび／またはラベルペア
   */
  constructor(options: Mn1613DisassemblerOptions = {}) {
    if (options.cdbText) this.labels.loadCdb(options.cdbText);
    if (options.labels) this.labels.setLabels(options.labels);
  }

  /**
   * CDB テキストからラベルを読み込む（バイトアドレス → ワード）。
   * @param cdbText SDCC CDB
   */
  loadCdb(cdbText: string): void {
    this.labels.loadCdb(cdbText);
  }

  /**
   * ラベル:ワードアドレスの組を登録する（既存アドレスは上書き）。
   * @param entries ペア列
   */
  setLabels(entries: Iterable<Mn1613LabelPair>): void {
    this.labels.setLabels(entries);
  }

  /**
   * 1 件追加する。
   * @param name ラベル名
   * @param wordAddr ワードアドレス
   */
  addLabel(name: string, wordAddr: number): void {
    this.labels.addLabel(name, wordAddr, "G");
  }

  /**
   * 指定ワードアドレスの 1 命令を逆アセンブルする。
   * @param addr ワードアドレス（IC と同じ単位）
   * @param readWord ワードアドレス → 16bit 値
   * @returns 文字列・消費ワード数・次アドレス
   */
  disassemble(addr: number, readWord: Mn1613ReadWord): Mn1613DisassembleResult {
    const a = addr & 0xffff;
    const inst = decodeMn1613(a, readWord);
    const wordCount = inst.wordCount;
    return {
      text: formatDecoded(inst, this.labels),
      wordCount,
      nextAddr: (a + wordCount) & 0xffff,
    };
  }
}
