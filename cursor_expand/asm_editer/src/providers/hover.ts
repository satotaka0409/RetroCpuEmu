import * as vscode from "vscode";
import { formatSubroutineDocMarkdown } from "../comments/jsdoc";
import { detectArchitecture } from "../cpu/registry";
import type { SymbolIndex } from "../symbols/index";
import { extractLabelRefs } from "../symbols/index";

/**
 * ホバー: .equ 定数の値表示、および呼び出し（BAL / BL 等）の JSDoc。
 * @param index - シンボル索引
 * @return HoverProvider
 */
export function createCallHoverProvider(
  index: SymbolIndex,
): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      if (document.languageId !== "mn1613asm") return undefined;

      const wordRange = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_.$][A-Za-z0-9_.$]*/,
      );
      if (!wordRange) return undefined;
      const word = document.getText(wordRange);
      const name = word.toUpperCase();
      const defs = index.lookup(name);

      // .equ 定数: 解決済みの値を優先表示
      const equ = defs.find((d) => d.kind === "equ");
      if (equ) {
        const parts: string[] = [`### \`${equ.name}\``, "", "`.equ` 定数"];
        if (equ.value !== undefined) {
          const v = equ.value >>> 0;
          parts.push(
            "",
            `| | |`,
            `|---|---|`,
            `| 値 (10進) | \`${equ.value}\` |`,
            `| 値 (16進) | \`0x${(v & 0xffff).toString(16).toUpperCase().padStart(4, "0")}\` |`,
          );
        } else if (equ.expr) {
          parts.push("", `_式:_ \`${equ.expr}\``, "", "_（値を解決できませんでした）_");
        }
        if (equ.expr && equ.value !== undefined) {
          parts.push("", `_式:_ \`${equ.expr}\``);
        }
        return new vscode.Hover(
          new vscode.MarkdownString(parts.join("\n")),
          wordRange,
        );
      }

      const arch = detectArchitecture(document.fileName);
      const line = document.lineAt(position.line);
      const { mnemonic, refs } = extractLabelRefs(line.text, arch);
      if (!mnemonic || !arch.callMnemonics.has(mnemonic)) {
        return undefined;
      }
      if (refs.length === 0) return undefined;

      const target =
        refs.find((r) => r === name) ?? refs[refs.length - 1]!;
      const callDefs = index.lookup(target);
      const parts: string[] = [];

      if (callDefs.length > 0 && callDefs[0]!.doc) {
        parts.push(formatSubroutineDocMarkdown(callDefs[0]!.doc, target));
      } else {
        parts.push(`### \`${target}\``);
        if (callDefs.length === 0) {
          parts.push("", "_（定義が見つかりません）_");
        } else {
          parts.push("", "_（サブルーチン用 JSDoc コメントなし）_");
        }
      }

      parts.push("", "---", "", arch.callingConvention.summaryMarkdown);

      return new vscode.Hover(new vscode.MarkdownString(parts.join("\n")));
    },
  };
}
