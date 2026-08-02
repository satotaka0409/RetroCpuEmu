import * as vscode from "vscode";
import { detectArchitecture } from "../cpu/registry";
import { parseAsmLine, type SymbolIndex } from "../symbols/index";

/**
 * アセンブリ診断（未定義ラベル / 未知命令）。
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
    const arch = detectArchitecture(document.fileName);
    const diagnostics: vscode.Diagnostic[] = [];

    for (let lineNo = 0; lineNo < document.lineCount; lineNo += 1) {
      const line = document.lineAt(lineNo);
      const parsed = parseAsmLine(line.text, arch);

      if (
        parsed.kind === "unknown" &&
        parsed.mnemonic &&
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

      for (const name of parsed.refs) {
        if (this.index.has(name)) continue;
        // オペランド側の出現位置を優先（行頭ラベルと同名でも誤らないよう後ろから探す）
        const upper = line.text.toUpperCase();
        let idx = upper.indexOf(name);
        if (idx < 0) continue;
        // ニーモニックより後にあればそちらを採用
        if (
          parsed.mnemonicEnd !== undefined &&
          idx < parsed.mnemonicEnd
        ) {
          const later = upper.indexOf(name, parsed.mnemonicEnd);
          if (later >= 0) idx = later;
        }
        const range = new vscode.Range(lineNo, idx, lineNo, idx + name.length);
        const d = new vscode.Diagnostic(
          range,
          `未定義ラベル: ${name}`,
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "mn1613asm";
        diagnostics.push(d);
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
}

/** @deprecated 互換エイリアス */
export { AsmDiagnostics as UndefinedLabelDiagnostics };
