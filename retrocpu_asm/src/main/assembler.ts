import { evalExpr, matchWordDiffReloc } from "./expression";
import { encodeInstruction, MN1613_ONLY_OPS, TWO_WORD_OPS } from "./encoder";
import {
  encodeTms9995Instruction,
  tms9995InstructionSize,
} from "./encoder_tms9995";
import { expandMacros } from "./macros";
import { parseSource } from "./parser";

import type {
  AssemblyResult,
  CpuType,
  EmittedWord,
  ParsedLine,
  SymbolInfoTable,
  SymbolTable,
  WordDiffReloc,
} from "./types";

/**
 * ディレクティブが消費する単位数を返す。
 * MN161x: ワード数、TMS9995: バイト数。
 * @param line - 解析済みソース行
 * @param cpuType - CPU
 * @return 消費サイズ
 */
function directiveSize(line: ParsedLine, cpuType: CpuType): number {
  if (!line.op) return 0;
  const op: string = line.op.toUpperCase();
  if (op === ".WORD" || op === "DW") {
    const words = line.args.length;
    return cpuType === "tms9995" ? words * 2 : words;
  }
  return 0;
}

/**
 * 疑似命令かどうかを判定する。
 * @param op - 命令または疑似命令名
 * @return 疑似命令ならtrue
 */
function isDirective(op: string): boolean {
  const o: string = op.toUpperCase();
  return o.startsWith(".") || o === "DW";
}

/**
 * シンボルテーブルにラベルを登録する。
 * @param sym - シンボルテーブル
 * @param label - ラベル名
 * @param value - 設定値
 * @param lineNo - 行番号
 */
function defineLabel(
  sym: SymbolTable,
  label: string,
  value: number,
  lineNo: number,
): void {
  const key: string = label.toUpperCase();
  if (sym.has(key)) {
    throw new Error(`Line ${lineNo}: Duplicate symbol ${label}`);
  }
  sym.set(key, value);
}

/**
 * .globl / .global で宣言された名前を収集する。
 * @param lines - 解析済みソース行配列
 * @return 大文字化したグローバル名の集合
 */
function collectGloblNames(lines: ParsedLine[]): Set<string> {
  const names: Set<string> = new Set();
  for (const line of lines) {
    if (!line.op) continue;
    const op: string = line.op.toUpperCase();
    if (op !== ".GLOBL" && op !== ".GLOBAL") continue;
    for (const arg of line.args) {
      const n: string = arg.trim();
      if (n) names.add(n.toUpperCase());
    }
  }
  return names;
}

/**
 * 定義済みシンボルと .globl 宣言から SymbolInfo 表を構築する。
 * @param symbols - 定義済みシンボル値
 * @param globlNames - .globl された名前
 * @return シンボル情報表
 */
function buildSymbolInfos(
  symbols: SymbolTable,
  globlNames: Set<string>,
): SymbolInfoTable {
  const infos: SymbolInfoTable = new Map();
  for (const [name, value] of symbols.entries()) {
    infos.set(name, {
      value,
      kind: globlNames.has(name) ? "global" : "local",
    });
  }
  for (const name of globlNames) {
    if (!infos.has(name)) {
      infos.set(name, { value: 0, kind: "external" });
    }
  }
  return infos;
}

/**
 * 第1パス：ラベルアドレスを確定してシンボルテーブルを構築する。
 * @param lines - 解析済みソース行配列
 * @param cpuType - CPUの種別
 * @return 第1パスで確定したシンボルテーブル
 */
function pass1(lines: ParsedLine[], cpuType: CpuType): SymbolTable {
  const symbols: SymbolTable = new Map();
  let pc: number = 0;
  const byteMode = cpuType === "tms9995";

  for (const line of lines) {
    if (line.label) {
      defineLabel(symbols, line.label, pc, line.lineNo);
    }

    if (!line.op) continue;
    const op: string = line.op.toUpperCase();

    if (cpuType === "mn1610" && MN1613_ONLY_OPS.has(op)) {
      throw new Error(
        `Line ${line.lineNo}: '${line.op}' は MN1613 専用命令です（--cpu mn1610 モードでは使用できません）`,
      );
    }

    if (op === ".EQU" || op === "EQU") {
      if (!line.label && line.args.length < 2) {
        throw new Error(
          `Line ${line.lineNo}: EQU requires label or 'name, expr'`,
        );
      }
      if (line.label) {
        if (line.args.length !== 1)
          throw new Error(
            `Line ${line.lineNo}: .equ label form requires one expression`,
          );
        symbols.set(
          line.label.toUpperCase(),
          evalExpr(line.args[0], symbols, true),
        );
      } else {
        const name: string = line.args[0];
        symbols.set(name.toUpperCase(), evalExpr(line.args[1], symbols, true));
      }
      continue;
    }

    if (op === ".ORG") {
      if (line.args.length !== 1)
        throw new Error(`Line ${line.lineNo}: .org requires one argument`);
      pc = evalExpr(line.args[0], symbols, true) & 0xffff;
      continue;
    }

    if (op === ".AREA" || op === ".GLOBL" || op === ".GLOBAL") {
      continue;
    }

    if (isDirective(op)) {
      pc += directiveSize(line, cpuType);
      continue;
    }

    if (byteMode) {
      pc += tms9995InstructionSize(line);
    } else {
      pc += TWO_WORD_OPS.has(op) ? 2 : 1;
    }
  }

  return symbols;
}

/**
 * エンコード済みワードを出力配列に追加する。
 * @param words - 出力ワード配列
 * @param address - アドレス（MN161x: ワード / TMS: バイト）
 * @param value - 16bit値
 * @param line - 元ソース行
 */
function emitWord(
  words: EmittedWord[],
  address: number,
  value: number,
  line: ParsedLine,
): void {
  words.push({
    address,
    value: value & 0xffff,
    lineNo: line.lineNo,
    source: line.text,
  });
}

/**
 * 第2パス：命令をエンコードして出力ワードとリロケーションを生成する。
 * @param lines - 解析済みソース行配列
 * @param symbols - 定義済みシンボルテーブル
 * @param symbolInfos - シンボル情報表
 * @param cpuType - CPUの種別
 * @return エンコード済みワードとリロケーション
 */
function pass2(
  lines: ParsedLine[],
  symbols: SymbolTable,
  symbolInfos: SymbolInfoTable,
  cpuType: CpuType,
): { words: EmittedWord[]; relocs: WordDiffReloc[] } {
  const words: EmittedWord[] = [];
  const relocs: WordDiffReloc[] = [];
  let pc: number = 0;
  const byteMode = cpuType === "tms9995";
  const addrStep = byteMode ? 2 : 1;

  for (const line of lines) {
    if (!line.op) continue;
    const op: string = line.op.toUpperCase();

    if (op === ".EQU" || op === "EQU") {
      continue;
    }

    if (op === ".ORG") {
      pc = evalExpr(line.args[0], symbols, false) & 0xffff;
      continue;
    }

    if (op === ".AREA" || op === ".GLOBL" || op === ".GLOBAL") {
      continue;
    }

    if (op === ".WORD" || op === "DW") {
      for (const arg of line.args) {
        const diff = matchWordDiffReloc(arg, symbolInfos);
        if (diff) {
          emitWord(words, pc, 0, line);
          relocs.push({
            byteAddr: byteMode ? pc : pc * 2,
            left: diff.left,
            right: diff.right,
          });
          pc += addrStep;
          continue;
        }
        for (const [name, info] of symbolInfos) {
          if (info.kind !== "external") continue;
          const re = new RegExp(
            `(^|[^A-Za-z0-9_.$])${name}([^A-Za-z0-9_.$]|$)`,
            "i",
          );
          if (re.test(arg)) {
            throw new Error(
              `Line ${line.lineNo}: unsupported external expression '${arg}' (only A - B address diffs are supported)`,
            );
          }
        }
        const value: number = evalExpr(arg, symbols, false);
        emitWord(words, pc, value, line);
        pc += addrStep;
      }
      continue;
    }

    const ws: number[] =
      cpuType === "tms9995"
        ? encodeTms9995Instruction(line, pc, symbols, false)
        : encodeInstruction(line, pc, symbols, false, cpuType);
    for (let i = 0; i < ws.length; i++) {
      emitWord(words, pc + i * addrStep, ws[i], line);
    }
    pc += ws.length * addrStep;
  }

  return { words, relocs };
}

/**
 * アセンブラソースを2パスでアセンブルする。
 * @param sourceText - アセンブラソース全文
 * @param cpuType - CPUの種別（デフォルト: "mn1613"）
 * @return アセンブル結果
 */
export function assemble(
  sourceText: string,
  cpuType: CpuType = "mn1613",
): AssemblyResult {
  const expanded: string = expandMacros(sourceText);
  const {
    sourceLines,
    parsed,
  }: { sourceLines: AssemblyResult["sourceLines"]; parsed: ParsedLine[] } =
    parseSource(expanded);
  const symbols: SymbolTable = pass1(parsed, cpuType);
  const globlNames: Set<string> = collectGloblNames(parsed);
  const symbolInfos: SymbolInfoTable = buildSymbolInfos(symbols, globlNames);
  const { words, relocs } = pass2(parsed, symbols, symbolInfos, cpuType);
  return {
    words,
    symbols,
    symbolInfos,
    relocs,
    sourceLines,
    cpuType,
    addressUnit: cpuType === "tms9995" ? "byte" : "word",
  };
}
