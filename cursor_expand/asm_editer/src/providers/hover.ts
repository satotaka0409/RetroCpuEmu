import * as vscode from "vscode";
import {
  formatSubroutineDocMarkdown,
  pickDeclarationDoc,
} from "../comments/jsdoc";
import { detectArchitecture } from "../cpu/registry";
import type { SymbolIndex } from "../symbols/index";
import { extractLabelRefs } from "../symbols/index";

/**
 * ホバー: .equ の値、グローバルラベルの宣言コメント（JSDoc なら強調）、呼び出し規約。
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
        const equDoc = pickDeclarationDoc(defs);
        if (equDoc) {
          parts.push("", formatSubroutineDocMarkdown(equDoc, equ.name));
        }
        return new vscode.Hover(
          new vscode.MarkdownString(parts.join("\n")),
          wordRange,
        );
      }

      const arch = detectArchitecture(document.fileName, document.getText());
      const line = document.lineAt(position.line);
      const { mnemonic, refs } = extractLabelRefs(line.text, arch);
      const onCall =
        !!mnemonic &&
        arch.callMnemonics.has(mnemonic) &&
        refs.some((r) => r === name);

      const isGlobal = defs.some((d) => d.kind === "global");
      if (isGlobal) {
        const doc = pickDeclarationDoc(defs);
        const parts: string[] = [];
        if (doc) {
          parts.push(formatSubroutineDocMarkdown(doc, name));
        } else {
          parts.push(`### \`${name}\``, "", "_グローバルラベル（宣言コメントなし）_");
        }
        if (onCall) {
          parts.push("", "---", "", arch.callingConvention.summaryMarkdown);
        }
        const md = new vscode.MarkdownString(parts.join("\n"));
        md.supportHtml = false;
        return new vscode.Hover(md, wordRange);
      }

      if (!onCall) {
        return undefined;
      }
      if (refs.length === 0) return undefined;

      const target = refs.find((r) => r === name) ?? refs[refs.length - 1]!;
      const callDefs = index.lookup(target);
      const parts: string[] = [];
      const callDoc = pickDeclarationDoc(callDefs);

      if (callDoc) {
        parts.push(formatSubroutineDocMarkdown(callDoc, target));
      } else {
        parts.push(`### \`${target}\``);
        if (callDefs.length === 0) {
          parts.push("", "_（定義が見つかりません）_");
        } else {
          parts.push("", "_（サブルーチン用コメントなし）_");
        }
      }

      parts.push("", "---", "", arch.callingConvention.summaryMarkdown);

      return new vscode.Hover(new vscode.MarkdownString(parts.join("\n")));
    },
  };
}
