/**
 * 逆アセンブラ用ラベル表（CDB / 手動ペア）
 * 根拠: emulater_code_test.mdc（CDB はバイトアドレス）
 */

import { parseCdb } from "../../load/cdb";
import type { Mn1613LabelPair } from "./types";

/**
 * アドレス → ラベル名の対応を持つ。
 * 同一アドレスに複数あるときはグローバル（G）を優先し、同じなら先勝ち。
 */
export class Mn1613LabelTable {
  private readonly byAddr = new Map<number, { name: string; scope: string }>();

  /**
   * CDB テキストからラベルを取り込む。
   * @param cdbText SDCC CDB（`L:` の末尾はバイトアドレス）
   */
  loadCdb(cdbText: string): void {
    const table = parseCdb(cdbText);
    for (const sym of table.symbols) {
      this._put(sym.wordAddr & 0xffff, sym.name, sym.scope);
    }
  }

  /**
   * ラベル:ワードアドレスの組を登録する（明示指定は既存を上書き）。
   * @param entries ペア列
   */
  setLabels(entries: Iterable<Mn1613LabelPair>): void {
    for (const e of entries) {
      const addr = e.wordAddr & 0xffff;
      const name = e.name.trim();
      if (!name) continue;
      this.byAddr.set(addr, { name, scope: "G" });
    }
  }

  /**
   * 1 件追加する。同一アドレスに G があるとき F/L は無視。
   * @param name ラベル名
   * @param wordAddr ワードアドレス
   * @param scope CDB スコープ。省略時は上書き
   */
  addLabel(name: string, wordAddr: number, scope = "G"): void {
    const n = name.trim();
    if (!n) return;
    this._put(wordAddr & 0xffff, n, scope);
  }

  /**
   * ワードアドレスに対応するラベル名を返す。
   * @param wordAddr ワードアドレス
   * @returns ラベル名。無ければ undefined
   */
  lookup(wordAddr: number): string | undefined {
    return this.byAddr.get(wordAddr & 0xffff)?.name;
  }

  /**
   * 登録件数。
   * @returns ユニークなアドレス数
   */
  get size(): number {
    return this.byAddr.size;
  }

  /**
   * アドレスへラベルを載せる。G は常に勝ち、F/L は空きまたは非 G のときだけ。
   * @param addr ワードアドレス
   * @param name ラベル名
   * @param scope G / F / L など
   */
  private _put(addr: number, name: string, scope: string): void {
    const prev = this.byAddr.get(addr);
    if (!prev || scope === "G" || prev.scope !== "G") {
      this.byAddr.set(addr, { name, scope });
    }
  }
}
