import {
  asciiCodesFromStringArg,
  evalExpr,
  matchAbsAddrReloc,
  matchPage0StarReloc,
  matchWordDiffReloc,
} from "./expression";
import {
  encodeInstruction,
  MN1613_ONLY_OPS,
  TWO_WORD_OPS,
  u16,
} from "./mn1613/mn1613_encoder";
import {
  encodeTms9995Instruction,
  tms9995InstructionSize,
} from "./tms9995/tms9995_encode";
import { expandMacros } from "./macros";
import { parseSource } from "./parser";
import { resolveCpuType } from "./cpuType";
import { collectCheckpoints } from "./checkpoint";
import type {
  AreaInfo,
  AssemblyResult,
  CpuType,
  EmittedWord,
  ParsedLine,
  SymbolInfoTable,
  SymbolTable,
  WordDiffReloc,
} from "./types";
import { canonicalAreaName, orderLinkAreaNames } from "./areaOrder";

/** 領域ごとのロケーションカウンタ。`.org` は現在領域にだけ効く。 */
type AreaLoc = { pc: number; noload: boolean };

/** `.area` 切替用の作業状態。無名領域（初期）の原点は 0。 */
type AreaContext = {
  current: string;
  areas: Map<string, AreaLoc>;
};

/**
 * 領域コンテキストを初期化する（無名領域 PC=0）。
 * @returns 空の領域コンテキスト
 */
function createAreaContext(): AreaContext {
  const areas: Map<string, AreaLoc> = new Map();
  areas.set("", { pc: 0, noload: false });
  return { current: "", areas };
}

/**
 * 現在領域のロケーションカウンタを返す。
 * @param ctx - 領域コンテキスト
 * @returns 現在 PC
 */
function areaPc(ctx: AreaContext): number {
  return ctx.areas.get(ctx.current)!.pc;
}

/**
 * 現在領域のロケーションカウンタを設定する。
 * @param ctx - 領域コンテキスト
 * @param pc - 新しい PC（16bit にマスク）
 */
function setAreaPc(ctx: AreaContext, pc: number): void {
  ctx.areas.get(ctx.current)!.pc = pc & 0xffff;
}

/**
 * 現在領域が NOLOAD（イメージに出さない）かどうか。
 * @param ctx - 領域コンテキスト
 * @returns NOLOAD なら true
 */
function areaNoload(ctx: AreaContext): boolean {
  return ctx.areas.get(ctx.current)!.noload;
}

/**
 * `.area` で領域を切り替える。未作成なら PC=0 で作る。
 * `_WORK` および `(NOLOAD)` 付きはイメージへワードを出さない。
 * @param ctx - 領域コンテキスト
 * @param name - 領域名
 * @param noload - NOLOAD なら true
 */
function switchArea(ctx: AreaContext, name: string, noload: boolean): void {
  const key: string = name.toUpperCase();
  let loc: AreaLoc | undefined = ctx.areas.get(key);
  if (!loc) {
    loc = { pc: 0, noload };
    ctx.areas.set(key, loc);
  } else if (noload) {
    loc.noload = true;
  }
  ctx.current = key;
}

/** sdas / asxxxx の `.area` フラグ（大文字） */
const AREA_FLAGS = new Set([
  "REL",
  "ABS",
  "CON",
  "OVR",
  "PAG",
  "NOPAG",
  "NOLOAD",
  "CODE",
  "DATA",
  "XDATA",
  "BIT",
]);

/**
 * `.area` の名前と NOLOAD 属性を取る。
 * sdas 形式: `.area _CODE (REL,CON)` / `.area _WORK (REL,NOLOAD)`。
 * `_WORK` は常に NOLOAD（RAM ワーク。初期値をイメージに出さない）。
 * `_DATA` は ROM（値あり）。`.word` / `.dw` を出す。
 * @param args - `.area` の引数
 * @param lineNo - 行番号
 * @returns 領域名と NOLOAD フラグ
 */
function parseAreaDirective(
  args: string[],
  lineNo: number,
): { name: string; noload: boolean } {
  if (args.length < 1 || !args[0]!.trim()) {
    throw new Error(`Line ${lineNo}: .area requires a name`);
  }
  const joined: string = args.join(" ").trim();
  const paren: number = joined.indexOf("(");
  const name: string = (paren < 0 ? joined : joined.slice(0, paren)).trim();
  if (!name) {
    throw new Error(`Line ${lineNo}: .area requires a name`);
  }
  const flagText: string = paren < 0 ? "" : joined.slice(paren);
  const flags: string[] = flagText
    .replace(/[()]/g, " ")
    .split(/[\s,]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f.length > 0);
  for (const f of flags) {
    if (!AREA_FLAGS.has(f)) {
      throw new Error(
        `Line ${lineNo}: unknown .area flag '${f}' (REL/ABS/CON/OVR/PAG/NOLOAD/...)`,
      );
    }
  }
  const noload: boolean =
    name.toUpperCase() === "_WORK" || flags.includes("NOLOAD");
  return { name, noload };
}

/**
 * `.ds` / `.blkw` が消費するアドレス単位数を返す。
 * MN161x: どちらもワード数。TMS9995: `.ds` はバイト、`.blkw` はワード（×2）。
 * @param op - `.DS` または `.BLKW`
 * @param count - 指定個数
 * @param cpuType - CPU
 * @returns 消費する PC 増分
 */
function storageSize(op: string, count: number, cpuType: CpuType): number {
  if (cpuType === "tms9995" && op === ".BLKW") {
    return count * 2;
  }
  return count;
}

/**
 * `.ds` / `.blkw` の予約サイズを評価する。
 * @param line - 解析済みソース行
 * @param symbols - シンボルテーブル
 * @param pass1 - 第1パスなら true（前方参照を許容）
 * @param cpuType - CPU
 * @returns 消費する PC 増分
 */
function evalStorageReserve(
  line: ParsedLine,
  symbols: SymbolTable,
  pass1: boolean,
  cpuType: CpuType,
): number {
  const op: string = line.op!.toUpperCase();
  if (line.args.length !== 1) {
    throw new Error(`Line ${line.lineNo}: ${line.op} requires one argument`);
  }
  const count: number = evalExpr(line.args[0]!, symbols, pass1);
  if (count < 0) {
    throw new Error(`Line ${line.lineNo}: ${line.op} count must not be negative`);
  }
  return storageSize(op, count, cpuType) & 0xffff;
}

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
  if (op === ".WORD" || op === ".DW" || op === "DW") {
    const words = expandWordDirectiveArgs(line.args, line.lineNo).length;
    return cpuType === "tms9995" ? words * 2 : words;
  }
  return 0;
}

/**
 * `.dw` / `.word` のオペランドを 1 ワードずつにする。
 * 二重引用符は 1 文字 1 ワード（ASCII）。`'H'` はそのまま式として残す。
 * @param args - 解析済みオペランド
 * @param lineNo - 行番号（エラー用）
 * @returns 1 ワード分の式（数値または `'H'` など）
 */
function expandWordDirectiveArgs(
  args: readonly string[],
  lineNo: number,
): string[] {
  const out: string[] = [];
  for (const arg of args) {
    let codes: number[] | null;
    try {
      codes = asciiCodesFromStringArg(arg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Line ${lineNo}: ${msg}`);
    }
    if (codes) {
      for (const c of codes) out.push(String(c));
      continue;
    }
    out.push(arg);
  }
  return out;
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
 * @param symbolAreas - ラベルが属する領域
 * @return シンボル情報表
 */
function buildSymbolInfos(
  symbols: SymbolTable,
  globlNames: Set<string>,
  symbolAreas: Map<string, string>,
): SymbolInfoTable {
  const infos: SymbolInfoTable = new Map();
  for (const [name, value] of symbols.entries()) {
    infos.set(name, {
      value,
      kind: globlNames.has(name) ? "global" : "local",
      area: symbolAreas.get(name),
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
 * 領域コンテキストからサイズ表を作る。無名は `_CODE` に寄せる。
 * @param ctx - 領域コンテキスト
 * @returns リンク順の領域情報
 */
function snapshotAreas(ctx: AreaContext): AreaInfo[] {
  const byName: Map<string, AreaInfo> = new Map();
  for (const [name, loc] of ctx.areas) {
    if (name === "" && loc.pc === 0) continue;
    const key: string = canonicalAreaName(name);
    const prev: AreaInfo | undefined = byName.get(key);
    const noload: boolean = loc.noload || key === "_WORK";
    if (!prev) {
      byName.set(key, { name: key, size: loc.pc, noload });
    } else {
      prev.size = Math.max(prev.size, loc.pc);
      prev.noload = prev.noload || noload;
    }
  }
  return orderLinkAreaNames(byName.keys()).map((n) => byName.get(n)!);
}

/**
 * 第1パス：ラベルアドレスを確定してシンボルテーブルを構築する。
 * @param lines - 解析済みソース行配列
 * @param cpuType - CPUの種別
 * @return 第1パスで確定したシンボルテーブルと領域
 */
function pass1(
  lines: ParsedLine[],
  cpuType: CpuType,
): {
  symbols: SymbolTable;
  symbolAreas: Map<string, string>;
  lineAreas: Map<number, string>;
} {
  const symbols: SymbolTable = new Map();
  const symbolAreas: Map<string, string> = new Map();
  const lineAreas: Map<number, string> = new Map();
  const areas: AreaContext = createAreaContext();
  const byteMode = cpuType === "tms9995";

  for (const line of lines) {
    lineAreas.set(line.lineNo, canonicalAreaName(areas.current));
    if (!line.op) {
      if (line.label) {
        defineLabel(symbols, line.label, areaPc(areas), line.lineNo);
        symbolAreas.set(
          line.label.toUpperCase(),
          canonicalAreaName(areas.current),
        );
      }
      continue;
    }
    const op: string = line.op.toUpperCase();

    if (line.label && op !== ".EQU" && op !== "EQU") {
      defineLabel(symbols, line.label, areaPc(areas), line.lineNo);
      symbolAreas.set(
        line.label.toUpperCase(),
        canonicalAreaName(areas.current),
      );
    }

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
      setAreaPc(areas, evalExpr(line.args[0], symbols, true));
      continue;
    }

    if (op === ".AREA") {
      const area = parseAreaDirective(line.args, line.lineNo);
      switchArea(areas, area.name, area.noload);
      continue;
    }

    if (op === ".GLOBL" || op === ".GLOBAL" || op === ".CPU") {
      continue;
    }

    if (op === ".DS" || op === ".BLKW") {
      setAreaPc(
        areas,
        areaPc(areas) + evalStorageReserve(line, symbols, true, cpuType),
      );
      continue;
    }

    if (isDirective(op)) {
      if (areaNoload(areas) && (op === ".WORD" || op === ".DW" || op === "DW")) {
        throw new Error(
          `Line ${line.lineNo}: ${areas.current} cannot have initial values (use .ds)`,
        );
      }
      setAreaPc(areas, areaPc(areas) + directiveSize(line, cpuType));
      continue;
    }

    if (areaNoload(areas)) {
      throw new Error(
        `Line ${line.lineNo}: cannot emit instructions in noload area ${areas.current}`,
      );
    }

    if (byteMode) {
      setAreaPc(areas, areaPc(areas) + tms9995InstructionSize(line));
    } else {
      setAreaPc(areas, areaPc(areas) + (TWO_WORD_OPS.has(op) ? 2 : 1));
    }
  }

  return { symbols, symbolAreas, lineAreas };
}

/**
 * エンコード済みワードを出力配列に追加する。
 * @param words - 出力ワード配列
 * @param address - アドレス（MN161x: ワード / TMS: バイト）
 * @param value - 16bit値
 * @param line - 元ソース行
 * @param area - 属する `.area`
 */
function emitWord(
  words: EmittedWord[],
  address: number,
  value: number,
  line: ParsedLine,
  area: string,
): void {
  words.push({
    address,
    value: value & 0xffff,
    lineNo: line.lineNo,
    source: line.text,
    area: canonicalAreaName(area),
  });
}

/**
 * 第2パス：命令をエンコードして出力ワードとリロケーションを生成する。
 * @param lines - 解析済みソース行配列
 * @param symbols - 定義済みシンボルテーブル
 * @param symbolInfos - シンボル情報表
 * @param cpuType - CPUの種別
 * @return エンコード済みワードとリロケーションと領域サイズと `.ds` 行アドレス
 */
function pass2(
  lines: ParsedLine[],
  symbols: SymbolTable,
  symbolInfos: SymbolInfoTable,
  cpuType: CpuType,
): {
  words: EmittedWord[];
  relocs: WordDiffReloc[];
  areas: AreaInfo[];
  storageAddrs: Map<number, number>;
} {
  const words: EmittedWord[] = [];
  const relocs: WordDiffReloc[] = [];
  const storageAddrs: Map<number, number> = new Map();
  const areas: AreaContext = createAreaContext();
  const byteMode = cpuType === "tms9995";
  const addrStep = byteMode ? 2 : 1;

  for (const line of lines) {
    if (!line.op) continue;
    const op: string = line.op.toUpperCase();

    if (op === ".EQU" || op === "EQU") {
      continue;
    }

    if (op === ".ORG") {
      setAreaPc(areas, evalExpr(line.args[0], symbols, false));
      continue;
    }

    if (op === ".AREA") {
      const area = parseAreaDirective(line.args, line.lineNo);
      switchArea(areas, area.name, area.noload);
      continue;
    }

    if (op === ".GLOBL" || op === ".GLOBAL" || op === ".CPU") {
      continue;
    }

    if (op === ".DS" || op === ".BLKW") {
      storageAddrs.set(line.lineNo, areaPc(areas));
      setAreaPc(
        areas,
        areaPc(areas) + evalStorageReserve(line, symbols, false, cpuType),
      );
      continue;
    }

    if (op === ".WORD" || op === ".DW" || op === "DW") {
      if (areaNoload(areas)) {
        throw new Error(
          `Line ${line.lineNo}: ${areas.current} cannot have initial values (use .ds)`,
        );
      }
      for (const arg of expandWordDirectiveArgs(line.args, line.lineNo)) {
        const diff = matchWordDiffReloc(arg, symbolInfos);
        if (diff) {
          throw new Error(
            `Line ${line.lineNo}: unsupported external expression '${arg}' (sdld cannot relocate A-B; both labels must be in the same module)`,
          );
        }
        const absRel = matchAbsAddrReloc(arg, symbolInfos);
        if (absRel) {
          let placeholder =
            absRel.left.kind === "symbol"
              ? 0
              : evalExpr(arg, symbols, false) & 0xffff;
          if (!byteMode && absRel.left.kind === "word") {
            placeholder = (placeholder * 2) & 0xffff;
          }
          emitWord(words, areaPc(areas), placeholder, line, areas.current);
          relocs.push({
            byteAddr: byteMode ? areaPc(areas) : areaPc(areas) * 2,
            left: absRel.left,
            right: absRel.right,
            area: canonicalAreaName(areas.current),
          });
          setAreaPc(areas, areaPc(areas) + addrStep);
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
        let value: number;
        try {
          value = u16(evalExpr(arg, symbols, false), line.op);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Line ${line.lineNo}: ${msg}`);
        }
        emitWord(words, areaPc(areas), value, line, areas.current);
        setAreaPc(areas, areaPc(areas) + addrStep);
      }
      continue;
    }

    if (areaNoload(areas)) {
      throw new Error(
        `Line ${line.lineNo}: cannot emit instructions in noload area ${areas.current}`,
      );
    }

    const symbolsForEncode: SymbolTable = new Map(symbols);
    for (const [name, info] of symbolInfos) {
      if (info.kind === "external" && !symbolsForEncode.has(name)) {
        symbolsForEncode.set(name, 0);
      }
    }

    const pc: number = areaPc(areas);
    const ws: number[] =
      cpuType === "tms9995"
        ? encodeTms9995Instruction(line, pc, symbolsForEncode, false)
        : encodeInstruction(line, pc, symbolsForEncode, false, cpuType);
    for (let i = 0; i < ws.length; i++) {
      emitWord(words, pc + i * addrStep, ws[i], line, areas.current);
    }
    if (!byteMode && ws.length >= 2) {
      for (const arg of line.args) {
        const absRel = matchAbsAddrReloc(arg, symbolInfos);
        if (!absRel) continue;
        const last = words[words.length - 1]!;
        if (absRel.left.kind === "symbol") {
          last.value = 0;
        } else if (absRel.left.kind === "word") {
          last.value = (last.value * 2) & 0xffff;
        }
        relocs.push({
          byteAddr: (pc + addrStep) * 2,
          left: absRel.left,
          right: absRel.right,
          area: canonicalAreaName(areas.current),
        });
        break;
      }
    }
    if (!byteMode && ws.length === 1) {
      for (const arg of line.args) {
        const page0Rel = matchPage0StarReloc(arg, symbolInfos);
        if (!page0Rel) continue;
        const last = words[words.length - 1]!;
        if (page0Rel.left.kind === "symbol") {
          last.value = last.value & 0xff00;
        } else if (page0Rel.left.kind === "word") {
          last.value =
            (last.value & 0xff00) | ((page0Rel.left.value * 2) & 0xff);
        }
        relocs.push({
          byteAddr: pc * 2 + 1,
          left: page0Rel.left,
          right: page0Rel.right,
          area: canonicalAreaName(areas.current),
          width: "low8",
        });
        break;
      }
    }
    setAreaPc(areas, pc + ws.length * addrStep);
  }

  return { words, relocs, areas: snapshotAreas(areas), storageAddrs };
}

/**
 * アセンブラソースを2パスでアセンブルする。
 * CPU は第 2 引数を優先し、無ければ先頭の `.cpu`。どちらも無ければエラー。
 * @param sourceText - アセンブラソース全文
 * @param cpuType - CPUの種別（省略時はソース `.cpu`）
 * @return アセンブル結果
 */
export function assemble(
  sourceText: string,
  cpuType?: CpuType,
): AssemblyResult {
  const expanded: string = expandMacros(sourceText);
  const resolved: CpuType = resolveCpuType(cpuType, expanded);
  const {
    sourceLines,
    parsed,
  }: { sourceLines: AssemblyResult["sourceLines"]; parsed: ParsedLine[] } =
    parseSource(expanded);
  const { symbols, symbolAreas, lineAreas } = pass1(parsed, resolved);
  const globlNames: Set<string> = collectGloblNames(parsed);
  const symbolInfos: SymbolInfoTable = buildSymbolInfos(
    symbols,
    globlNames,
    symbolAreas,
  );
  const { words, relocs, areas, storageAddrs } = pass2(
    parsed,
    symbols,
    symbolInfos,
    resolved,
  );
  const checkpoints = collectCheckpoints(
    parsed,
    words,
    storageAddrs,
    lineAreas,
  );
  return {
    words,
    symbols,
    symbolInfos,
    relocs,
    areas,
    sourceLines,
    storageAddrs,
    cpuType: resolved,
    addressUnit: resolved === "tms9995" ? "byte" : "word",
    checkpoints,
  };
}

export { parseCpuType, resolveCpuType, scanSourceCpu } from "./cpuType";
