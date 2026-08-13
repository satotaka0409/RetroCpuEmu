import * as vscode from "vscode";
import type { SymbolIndex } from "../symbols/index";

const IDENT_RE = /[A-Za-z_.$][A-Za-z0-9_.$]*/;

/**
 * 定義へ移動（F12 / 右クリック「定義へ移動」）。
 * ラベル / .equ を SymbolIndex から解決する。
 * @param index - シンボル索引
 * @return DefinitionProvider
 */
export function createDefinitionProvider(
  index: SymbolIndex,
): vscode.DefinitionProvider {
  return {
    provideDefinition(document, position) {
      if (document.languageId !== "mn1613asm") return undefined;

      const wordRange = document.getWordRangeAtPosition(position, IDENT_RE);
      if (!wordRange) return undefined;

      const name = document.getText(wordRange).toUpperCase();
      const defs = index.lookup(name);
      if (defs.length === 0) return undefined;

      return defs.map(
        (sym) =>
          new vscode.Location(
            vscode.Uri.parse(sym.uri),
            new vscode.Position(sym.line, 0),
          ),
      );
    },
  };
}
