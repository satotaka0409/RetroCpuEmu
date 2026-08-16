#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { assemble } from "./assembler";
import { parseCpuType, resolveCpuType } from "./cpuType";
import { writeLst } from "./lstWriter";
import { stripLineComment } from "./parser";
import { writeRel } from "./relWriter";
import type { AssemblyResult, CpuType } from "./types";

/**
 * CLIオプション
 */
interface CliOptions {
  input: string;
  outRel?: string;
  outLst?: string;
  moduleName?: string;
  /** ターゲットCPU。未指定ならソース先頭の `.cpu` を使う */
  cpuType?: CpuType;
}

const USAGE =
  "Usage: retrocpu_asm [--cpu|-m mn1610|mn1613|tms9995] <input.asm> [-o out.rel] [--lst out.lst] [--module NAME]";

/**
 * INCLUDEディレクティブのオペランドからファイルパスを取り出す。
 * @param operandText - INCLUDEディレクティブのオペランド文字列
 * @return include対象ファイルパス
 */
function parseIncludeOperand(operandText: string): string {
  const trimmed: string = operandText.trim();
  if (!trimmed) {
    throw new Error("INCLUDE requires a file path.");
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

/**
 * INCLUDEディレクティブを再帰的に展開してソース全文を返す。
 * @param entryPath - 起点ASMファイル
 * @param includeStack - include解決中のファイルスタック
 * @return INCLUDE展開済みソース全文
 */
export function expandIncludesFromFile(
  entryPath: string,
  includeStack: string[] = [],
): string {
  const absPath: string = path.resolve(entryPath);
  if (includeStack.includes(absPath)) {
    const cycle: string = [...includeStack, absPath].join(" -> ");
    throw new Error(`Include cycle detected: ${cycle}`);
  }

  const text: string = fs.readFileSync(absPath, "utf8");
  const lines: string[] = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i: number = 0; i < lines.length; i += 1) {
    const raw: string = lines[i];
    const body: string = stripLineComment(raw).trim();
    const m: RegExpMatchArray | null = body.match(
      /^(?:\.INCLUDE|INCLUDE)\s+(.+)$/i,
    );
    if (!m) {
      out.push(raw);
      continue;
    }

    const includeOperand: string = parseIncludeOperand(m[1]);
    const includeFile: string = path.isAbsolute(includeOperand)
      ? includeOperand
      : path.resolve(path.dirname(absPath), includeOperand);

    if (!fs.existsSync(includeFile)) {
      throw new Error(
        `Include file not found: ${includeOperand} (${absPath}:${i + 1})`,
      );
    }

    out.push(expandIncludesFromFile(includeFile, [...includeStack, absPath]));
  }

  return out.join("\n");
}

/**
 * コマンドライン引数を解析してCLIオプションを返す。
 * `--cpu` / `-m` は任意。未指定ならソース先頭の `.cpu` を使う。
 * @param argv - コマンドライン引数配列
 * @return 解析済みのCLIオプション
 */
export function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0) {
    throw new Error(USAGE);
  }

  const opts: Partial<CliOptions> & { input: string } = { input: "" };
  let i: number = 0;
  while (i < argv.length) {
    const a: string | undefined = argv[i];
    if (!a) break;

    if (a === "-o" || a === "--out") {
      i += 1;
      opts.outRel = argv[i];
      i += 1;
      continue;
    }
    if (a === "--lst") {
      i += 1;
      opts.outLst = argv[i];
      i += 1;
      continue;
    }
    if (a === "--module") {
      i += 1;
      opts.moduleName = argv[i];
      i += 1;
      continue;
    }
    if (a === "--cpu" || a === "-m") {
      i += 1;
      const val: string | undefined = argv[i];
      const cpu = parseCpuType(val);
      if (!cpu) {
        throw new Error(
          `--cpu/-m の値は mn1610 / mn1613 / tms9995 で指定してください（値: ${val}）\n${USAGE}`,
        );
      }
      opts.cpuType = cpu;
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }

    if (!opts.input) {
      opts.input = a;
      i += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${a}`);
  }

  if (!opts.input) {
    throw new Error(`Input file is required.\n${USAGE}`);
  }
  return opts as CliOptions;
}

/**
 * 入力ファイルパスからREL／LSTのデフォルト出力パスを生成する。
 * @param input - 入力ASMファイルパス
 * @return REL/LSTのデフォルト出力パス
 */
function defaultPaths(input: string): { rel: string; lst: string } {
  const dir: string = path.dirname(input);
  const base: string = path.basename(input, path.extname(input));
  return {
    rel: path.join(dir, `${base}.rel`),
    lst: path.join(dir, `${base}.lst`),
  };
}

/**
 * 致命的エラーを stderr にメッセージだけ出して終了する（スタックは出さない）。
 * @param err 例外または文字列
 * @param exitCode 終了コード（既定 1）
 */
export function fatalCliError(err: unknown, exitCode = 1): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(exitCode);
}

/**
 * CLIエントリポイント。アセンブルを実行してREL／LSTを出力する。
 * 失敗時はメッセージを stderr に出して終了コード 1（スタックトレースなし）。
 */
export function main(argv: string[] = process.argv.slice(2)): void {
  const opts: CliOptions = parseArgs(argv);
  if (!fs.existsSync(opts.input)) {
    throw new Error(`Input file not found: ${opts.input}`);
  }
  const asmText: string = expandIncludesFromFile(opts.input);
  const cpuType: CpuType = resolveCpuType(opts.cpuType, asmText);
  const result: AssemblyResult = assemble(asmText, cpuType);

  const d: { rel: string; lst: string } = defaultPaths(opts.input);
  const relPath: string = opts.outRel ?? d.rel;
  const lstPath: string = opts.outLst ?? d.lst;

  fs.writeFileSync(
    relPath,
    writeRel(
      result,
      opts.moduleName ?? (cpuType === "tms9995" ? "TMS9995" : "MN1610"),
    ),
    "utf8",
  );
  fs.writeFileSync(lstPath, writeLst(result), "utf8");

  process.stdout.write(`Wrote ${relPath}\n`);
  process.stdout.write(`Wrote ${lstPath}\n`);
}

// 直接実行時のみ main() を呼び出す（import 時はスキップ）
if (require.main === module) {
  try {
    main();
  } catch (e) {
    fatalCliError(e);
  }
}
