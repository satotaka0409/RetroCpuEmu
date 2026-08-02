import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseSubroutineDocAbove } from "../comments/jsdoc";
import type { AsmSymbol } from "../cpu/types";
import { tryEvalExpr } from "../expression";
import { collectEquDefs, stripAsmComment } from "./equParse";
import { collectIncludePaths, resolveIncludePath } from "./includeParse";

export type { AsmLineParse } from "./parseLine";
export { parseAsmLine, extractLabelRefs } from "./parseLine";
export { collectIncludePaths, resolveIncludePath } from "./includeParse";

const ASM_GLOBS = "**/*.{asm,s,mn1613,mn1610,tms9995,inc,h}";

/**
 * ワークスペース内のラベル / .equ を保持する索引。
 */
export class SymbolIndex {
  private readonly byName = new Map<string, AsmSymbol[]>();
  private readonly byUri = new Map<string, AsmSymbol[]>();

  /**
   * 名前（大文字）でシンボルを検索する。
   * @param name - シンボル名
   * @return 定義一覧
   */
  lookup(name: string): AsmSymbol[] {
    return this.byName.get(name.toUpperCase()) ?? [];
  }

  /**
   * 定義済みかどうか。
   * @param name - シンボル名
   * @return 定義があれば true
   */
  has(name: string): boolean {
    return this.lookup(name).length > 0;
  }

  /**
   * ワークスペースを走査して索引を再構築する。
   * @return 収集したシンボル数
   */
  async rebuild(): Promise<number> {
    this.byName.clear();
    this.byUri.clear();
    const uris = await vscode.workspace.findFiles(
      ASM_GLOBS,
      "**/node_modules/**",
    );
    let count = 0;
    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        count += this.indexDocument(doc);
      } catch {
        // 読めないファイルはスキップ
      }
    }
    this.resolveEquValues();
    return count;
  }

  /**
   * 1 ドキュメントを索引に反映する（当該 URI の旧エントリを置換）。
   * `.include` 先も再帰的に取り込む。
   * @param document - テキストドキュメント
   * @return このファイルから採ったシンボル数（include は含めない）
   */
  indexDocument(document: vscode.TextDocument): number {
    const uriKey = document.uri.toString();
    this.removeUri(uriKey);

    const text = document.getText();
    const found = this.collectSymbolsFromText(uriKey, text);
    this.byUri.set(uriKey, found);

    this.indexIncludesRecursive(document.uri.fsPath, text, new Set([uriKey]));
    this.resolveEquValues();
    return found.length;
  }

  /**
   * INCLUDE / .INCLUDE のパスを相対解決して URI 候補を返す（診断用）。
   * @param document - 現在ドキュメント
   * @param includeOperand - オペランド文字列
   * @return 解決 URI。失敗時 undefined
   */
  resolveInclude(
    document: vscode.TextDocument,
    includeOperand: string,
  ): vscode.Uri | undefined {
    const resolved = resolveIncludePath(
      path.dirname(document.uri.fsPath),
      includeOperand,
    );
    return resolved ? vscode.Uri.file(resolved) : undefined;
  }

  /**
   * テキストからラベル / .equ を収集する。
   * @param uriKey - URI 文字列
   * @param text - ソース全文
   * @return シンボル一覧
   */
  private collectSymbolsFromText(uriKey: string, text: string): AsmSymbol[] {
    const lines = text.split(/\r?\n/);
    const found: AsmSymbol[] = [];
    const equByLine = new Map(
      collectEquDefs(text).map((d) => [d.line, d] as const),
    );

    for (let i = 0; i < lines.length; i += 1) {
      const stripped = stripAsmComment(lines[i]!);
      const equ = equByLine.get(i);
      if (equ) {
        const doc = parseSubroutineDocAbove(lines, i);
        const sym: AsmSymbol = {
          name: equ.name,
          kind: "equ",
          uri: uriKey,
          line: i,
          doc,
          expr: equ.expr,
        };
        found.push(sym);
        this.add(sym);
        continue;
      }

      const labelM = stripped.match(/^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/);
      if (labelM) {
        const name = labelM[1]!.toUpperCase();
        const doc = parseSubroutineDocAbove(lines, i);
        const sym: AsmSymbol = {
          name,
          kind: "label",
          uri: uriKey,
          line: i,
          doc,
        };
        found.push(sym);
        this.add(sym);
      }
    }
    return found;
  }

  /**
   * .include を辿ってシンボルを索引に載せる。
   * @param fromFsPath - 基準ファイルの fsPath
   * @param text - 基準ファイル本文
   * @param visited - 処理済み URI
   */
  private indexIncludesRecursive(
    fromFsPath: string,
    text: string,
    visited: Set<string>,
  ): void {
    const dir = path.dirname(fromFsPath);
    for (const incPath of collectIncludePaths(text)) {
      const abs = resolveIncludePath(dir, incPath);
      if (!abs) continue;
      const uriKey = vscode.Uri.file(abs).toString();
      if (visited.has(uriKey)) continue;
      visited.add(uriKey);

      let incText: string;
      try {
        incText = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }

      this.removeUri(uriKey);
      const found = this.collectSymbolsFromText(uriKey, incText);
      this.byUri.set(uriKey, found);
      this.indexIncludesRecursive(abs, incText, visited);
    }
  }

  /**
   * .equ の式を可能な範囲で評価して value を埋める。
   */
  private resolveEquValues(): void {
    for (const [, list] of this.byName) {
      for (const sym of list) {
        if (sym.kind === "equ") sym.value = undefined;
      }
    }
    const values = new Map<string, number>();
    for (let pass = 0; pass < 8; pass += 1) {
      let progressed = false;
      for (const [, list] of this.byName) {
        for (const sym of list) {
          if (sym.kind !== "equ" || !sym.expr || sym.value !== undefined)
            continue;
          const v = tryEvalExpr(sym.expr, values);
          if (v === undefined) continue;
          sym.value = v;
          values.set(sym.name, v);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
  }

  private add(sym: AsmSymbol): void {
    const list = this.byName.get(sym.name) ?? [];
    list.push(sym);
    this.byName.set(sym.name, list);
  }

  private removeUri(uriKey: string): void {
    const old = this.byUri.get(uriKey);
    if (!old) return;
    for (const sym of old) {
      const list = this.byName.get(sym.name);
      if (!list) continue;
      const next = list.filter((s) => s.uri !== uriKey || s.line !== sym.line);
      if (next.length === 0) this.byName.delete(sym.name);
      else this.byName.set(sym.name, next);
    }
    this.byUri.delete(uriKey);
  }
}
