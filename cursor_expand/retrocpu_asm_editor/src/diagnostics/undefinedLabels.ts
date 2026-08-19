import * as vscode from "vscode";
import { findCheckpointComment } from "../comments/checkpoint";
import { unusedGlobalWarningSuppressed } from "../comments/unwarning";
import { findInvalidCpuDirectives } from "../cpu/parseCpuDirective";
import { detectArchitecture } from "../cpu/registry";
import { MN1613_COPY_SET_MNEMONICS } from "../cpu/mn1613/arch";
import { findInvalidAddressingOperands } from "./addressingModes";
import { findImmRangeOverflows } from "./immRange";
import { findTms9995SyntaxIssues } from "./tms9995Syntax";
import { findUnusedGlobalDeclarations } from "./unusedGlobals";
import {
  findInvalidCopySetOperands,
  findInvalidGprOperands,
} from "./invalidRegisters";
import {
  isAsmBuiltinCall,
  parseAsmLine,
  parseGlobalDirectiveNames,
  type SymbolIndex,
} from "../symbols/index";
import { findIdentRangesInLine } from "../symbols/occurrences";

/**
 * アセンブリ診断（未定義ラベル / 未使用グローバル / 未知命令 / 不正レジスタオペランド / 無効な .cpu）。
 */
export class AsmDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;

  /**
   * @param index - シンボル索引
   */
  constructor(private readonly index: SymbolIndex) {
    this.collection = vscode.languages.createDiagnosticCollection("mn1613asm");
  }

  /**
   * Disposable として登録する。
   * @return DiagnosticCollection
   */
  get disposable(): vscode.Disposable {
    return this.collection;
  }

  /**
   * 1 ドキュメントを診断する。
   * @param document - 対象
   */
  refresh(document: vscode.TextDocument): void {
    if (document.languageId !== "mn1613asm") {
      this.collection.delete(document.uri);
      return;
    }
    this.index.indexDocument(document);
    const arch = detectArchitecture(document.fileName, document.getText());
    // 未使用 `.global` は、ラベル/`.equ` 定義またはオペランド参照があれば消す。
    // 同じファイルの `name:` は使用箇所とみなす。他 .asm の BALD でも消える。
    const diagnostics: vscode.Diagnostic[] = [];

    for (const hit of findInvalidCpuDirectives(document.getText())) {
      const d = new vscode.Diagnostic(
        new vscode.Range(hit.line, hit.start, hit.line, hit.end),
        hit.message,
        vscode.DiagnosticSeverity.Error,
      );
      d.source = "mn1613asm";
      diagnostics.push(d);
    }

    for (let lineNo = 0; lineNo < document.lineCount; lineNo += 1) {
      const line = document.lineAt(lineNo);
      const cp = findCheckpointComment(line.text);
      if (cp && !cp.valid) {
        const start = cp.nameStart ?? cp.markerStart;
        const end = cp.nameEnd ?? cp.markerEnd;
        const d = new vscode.Diagnostic(
          new vscode.Range(lineNo, start, lineNo, Math.max(end, start + 1)),
          "チェックポイント名は英数字と _ のみ（先頭は英字/_、スペース・日本語不可）",
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "mn1613asm";
        diagnostics.push(d);
      }

      // `.global` / `.globl` は外部宣言。オペランドを未定義ラベルにしない
      if (parseGlobalDirectiveNames(line.text) !== null) {
        if (
          unusedGlobalWarningSuppressed(
            (i) =>
              i >= 0 && i < document.lineCount
                ? document.lineAt(i).text
                : undefined,
            lineNo,
          )
        ) {
          continue;
        }
        for (const hit of findUnusedGlobalDeclarations(
          line.text,
          arch,
          (n) =>
            this.index.hasOperandReference(n) || this.index.hasLabelOrEqu(n),
        )) {
          const d = new vscode.Diagnostic(
            new vscode.Range(lineNo, hit.start, lineNo, hit.end),
            hit.message,
            vscode.DiagnosticSeverity.Warning,
          );
          d.source = "mn1613asm";
          diagnostics.push(d);
        }
        continue;
      }

      const parsed = parseAsmLine(line.text, arch);

      if (
        parsed.kind === "unknown" &&
        parsed.mnemonic &&
        !parsed.mnemonic.startsWith(".") &&
        parsed.mnemonicStart !== undefined &&
        parsed.mnemonicEnd !== undefined
      ) {
        const range = new vscode.Range(
          lineNo,
          parsed.mnemonicStart,
          lineNo,
          parsed.mnemonicEnd,
        );
        const d = new vscode.Diagnostic(
          range,
          `未知の命令: ${parsed.mnemonic}`,
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "mn1613asm";
        diagnostics.push(d);
        continue;
      }

      if (parsed.kind !== "instruction" && parsed.kind !== "directive") {
        continue;
      }

      for (const hit of [
        ...findInvalidGprOperands(line.text, parsed, arch),
        ...findInvalidAddressingOperands(line.text, parsed, arch),
        ...findInvalidCopySetOperands(line.text, parsed, arch),
        ...findImmRangeOverflows(line.text, parsed, arch),
        ...findTms9995SyntaxIssues(line.text, parsed, arch),
      ]) {
        const d = new vscode.Diagnostic(
          new vscode.Range(lineNo, hit.start, lineNo, hit.end),
          hit.message,
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "mn1613asm";
        diagnostics.push(d);
      }

      const skipLabelRefs =
        parsed.mnemonic !== undefined &&
        MN1613_COPY_SET_MNEMONICS.has(parsed.mnemonic);
      for (const name of skipLabelRefs ? [] : parsed.refs) {
        if (name === "LEN") continue;
        if (this.index.has(name)) continue;
        let ranges = findIdentRangesInLine(
          line.text,
          name,
          parsed.mnemonicEnd ?? 0,
        );
        if (ranges.length === 0) {
          ranges = findIdentRangesInLine(line.text, name, 0);
        }
        for (const r of ranges) {
          if (isAsmBuiltinCall(name, line.text.slice(r.end))) continue;
          const range = new vscode.Range(lineNo, r.start, lineNo, r.end);
          const d = new vscode.Diagnostic(
            range,
            `未定義ラベル: ${name}`,
            vscode.DiagnosticSeverity.Error,
          );
          d.source = "mn1613asm";
          diagnostics.push(d);
        }
      }
    }
    this.collection.set(document.uri, diagnostics);
  }

  /**
   * 表示中ドキュメントをすべて再診断する。
   */
  refreshVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refresh(editor.document);
    }
  }

  /**
   * 開いているアセンブラを再診断する（索引は呼び出し側で更新済み想定）。
   * 他ファイルの参照追加で未使用グローバル警告を消す。
   */
  refreshOpen(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "mn1613asm") this.refresh(doc);
    }
  }
}

/** @deprecated 互換エイリアス */
export { AsmDiagnostics as UndefinedLabelDiagnostics };
