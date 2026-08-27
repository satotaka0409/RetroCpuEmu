import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ASM_DIST, FRAMEWORK_BUILD } from "./repo.js";
import { expandIncludes, expandIncludesFromFile } from "./expand_includes.js";
import { checkpointId, isSyntheticCheckpointGlobal } from "./checkpoint.js";
import { defsToCdb, imageToIntelHex } from "./hex_cdb.js";
import {
  mn1613DefaultCodeOrgWord,
  mn1613MainStub,
} from "./mn1613/main_stub.js";
import type {
  AsmCpuType,
  AsmSource,
  AssembleLinkOptions,
  AssembleToFilesOptions,
  AssembledModule,
  LinkedCheckpoint,
  LinkedImage,
} from "./types.js";

const requireAsm = createRequire(import.meta.url);

type AssembleFn = (source: string, cpu: AsmCpuType) => unknown;

type WriteRelFn = (result: unknown, moduleName: string) => string;

type LinkRelsWithSdldFn = (
  relPaths: string[],
  options?: { wordAddrFixup?: boolean; workDir?: string; outName?: string },
) => {
  hexText: string;
  cdbText: string;
  image: Uint8Array;
  defs: Map<string, number>;
};

type AssembleResultLike = {
  symbols: Map<string, number>;
};

/** L:__CP$name$0001:ADDR または L:G$__CP$name$0001:ADDR */
const CP_CDB_LINE =
  /^L:(?:G\$)?(__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})):([0-9A-Fa-f]+)$/;

/**
 * CDB 文字列からチェックポイントを抜き出す。
 * parseCdb() は MN1613 前提で奇数バイトを拒否するため、TMS9995 では本関数を使う。
 * @param cdbText CDB 全文
 * @returns チェックポイント一覧
 */
function parseCheckpointsFromCdb(cdbText: string): LinkedCheckpoint[] {
  const out: LinkedCheckpoint[] = [];
  const lines = cdbText.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(CP_CDB_LINE);
    if (!m) continue;
    const name = m[2]!;
    const serial = m[3]!;
    const byteAddr = parseInt(m[4]!, 16) >>> 0;
    out.push({
      name,
      serial,
      id: checkpointId(name, serial),
      byteAddr,
      wordAddr: byteAddr >>> 1,
    });
  }
  return out;
}

/**
 * retrocpu_asm の dist から関数を読む。未ビルドならエラー。
 * @returns assemble / writeRel / linkRelsWithSdld
 */
function loadAsmRuntime(): {
  assemble: AssembleFn;
  writeRel: WriteRelFn;
  linkRelsWithSdld: LinkRelsWithSdldFn;
} {
  const assemblerPath = path.join(ASM_DIST, "assembler.js");
  if (!fs.existsSync(assemblerPath)) {
    throw new Error(
      `retrocpu_asm が未ビルドです: ${assemblerPath}\n` +
        "`cd retrocpu_asm && npm run build` または `npm test`（test_framework が依存ビルドする）",
    );
  }
  const { assemble } = requireAsm(assemblerPath) as { assemble: AssembleFn };
  const { writeRel } = requireAsm(path.join(ASM_DIST, "relWriter.js")) as {
    writeRel: WriteRelFn;
  };
  const { linkRelsWithSdld } = requireAsm(
    path.join(ASM_DIST, "sdldLink.js"),
  ) as { linkRelsWithSdld: LinkRelsWithSdldFn };
  return { assemble, writeRel, linkRelsWithSdld };
}

/**
 * ソース指定からモジュール名を決める。
 * @param source 入力
 * @returns 大文字モジュール名
 */
function resolveModuleName(source: AsmSource): string {
  if ("text" in source) {
    return source.module.toUpperCase();
  }
  if (source.module) {
    return source.module.toUpperCase();
  }
  return path.basename(source.file, path.extname(source.file)).toUpperCase();
}

/**
 * ソース列に MAIN モジュールが含まれるか。
 * @param sources 入力
 * @returns MAIN があれば true
 */
export function sourcesHaveMain(sources: AsmSource[]): boolean {
  return sources.some((s) => resolveModuleName(s) === "MAIN");
}

export { mn1613MainStub } from "./mn1613/main_stub.js";

/**
 * `.asm` をアセンブルし sdld でリンクしてイメージ・HEX・CDB を返す。
 * MAIN が無い MN1613 では `_CODE` 原点スタブ（既定 0x0200）を入れる。
 * @param options ソースと CPU
 * @returns リンク結果
 */
export function assembleAndLink(options: AssembleLinkOptions): LinkedImage {
  const cpu: AsmCpuType = options.cpu ?? "mn1613";
  const hasMain = sourcesHaveMain(options.sources);
  const codeOrgWord =
    options.codeOrgWord !== undefined
      ? options.codeOrgWord
      : mn1613DefaultCodeOrgWord(cpu, hasMain);
  const { assemble, writeRel, linkRelsWithSdld } = loadAsmRuntime();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-sdld-"));
  const relPaths: string[] = [];
  const modules: AssembledModule[] = [];

  /**
   * 1 モジュールをアセンブルして .rel を書く。
   * @param sourceText ソース
   * @param moduleName モジュール名
   * @param sourcePath 表示用パス
   */
  const addModule = (
    sourceText: string,
    moduleName: string,
    sourcePath: string,
  ): void => {
    const result = assemble(sourceText, cpu) as AssembleResultLike;
    const relText = writeRel(result, moduleName);
    const relPath = path.join(workDir, `${moduleName}.rel`);
    fs.writeFileSync(relPath, relText, "utf8");
    relPaths.push(relPath);
    modules.push({
      module: moduleName,
      sourcePath,
      symbols: result.symbols,
    });
  };

  try {
    if (codeOrgWord > 0) {
      addModule(mn1613MainStub(codeOrgWord, cpu), "MAIN", "<test_frame_main>");
    }

    const sources = [...options.sources];
    const mainIdx = sources.findIndex((s) => resolveModuleName(s) === "MAIN");
    if (mainIdx > 0) {
      const [mainSrc] = sources.splice(mainIdx, 1);
      sources.unshift(mainSrc!);
    }

    for (const source of sources) {
      const moduleName = resolveModuleName(source);
      let sourceText: string;
      let sourcePath: string;
      if ("file" in source) {
        sourcePath = path.resolve(source.file);
        sourceText = expandIncludesFromFile(sourcePath);
      } else {
        sourcePath = `<inline:${moduleName}>`;
        sourceText = expandIncludes(
          source.text,
          source.fromDir ?? process.cwd(),
        );
      }
      addModule(sourceText, moduleName, sourcePath);
    }

    const linked = linkRelsWithSdld(relPaths, {
      workDir,
      wordAddrFixup: cpu !== "tms9995",
    });
    const globals = new Map<string, number>();
    const globalBytes = new Map<string, number>();
    for (const [name, byteAddr] of linked.defs) {
      if (isSyntheticCheckpointGlobal(name)) continue;
      if (/^__CP\$/i.test(name)) continue;
      const key = name.toUpperCase();
      globalBytes.set(key, byteAddr >>> 0);
      globals.set(key, byteAddr >>> 1);
    }

    const checkpoints = parseCheckpointsFromCdb(linked.cdbText);

    return {
      cpu,
      image: linked.image,
      globals,
      globalBytes,
      hexText: linked.hexText || imageToIntelHex(linked.image),
      cdbText: linked.cdbText || defsToCdb(linked.defs),
      modules,
      checkpoints,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * アセンブル／リンクし Intel HEX と CDB をファイルへ書く。
 * @param options ソースと出力パス
 * @returns リンク結果
 */
export function assembleToHexCdb(options: AssembleToFilesOptions): LinkedImage {
  const linked = assembleAndLink(options);
  const hexFile = path.resolve(options.hexFile);
  const cdbFile = path.resolve(options.cdbFile);
  fs.mkdirSync(path.dirname(hexFile), { recursive: true });
  fs.mkdirSync(path.dirname(cdbFile), { recursive: true });
  fs.writeFileSync(hexFile, linked.hexText, "utf8");
  fs.writeFileSync(cdbFile, linked.cdbText, "utf8");
  return linked;
}

/**
 * セッション用の既定 HEX / CDB パス。
 * @returns build/session.ihx と build/session.cdb
 */
export function defaultHexCdbPaths(): { hexFile: string; cdbFile: string } {
  return {
    hexFile: path.join(FRAMEWORK_BUILD, "session.ihx"),
    cdbFile: path.join(FRAMEWORK_BUILD, "session.cdb"),
  };
}

/**
 * リンク済みグローバルのワードアドレスを探す。
 * @param image リンク結果
 * @param name ラベル名（大文字小文字無視）
 * @returns ワードアドレス
 * @throws 見つからないとき
 */
export function lookupWordAddr(image: LinkedImage, name: string): number {
  if (image.cpu === "tms9995") {
    throw new Error(
      `lookupWordAddr is MN1613-only for now (symbol: ${name}). ` +
        "For TMS9995 use lookupByteAddr().",
    );
  }
  const key = name.toUpperCase();
  const g = image.globals.get(key);
  if (g !== undefined) {
    return g;
  }
  throw new Error(`Global symbol not found: ${name}`);
}

/**
 * リンク済みグローバルのバイトアドレスを探す（MN1613/TMS9995 共通）。
 * @param image リンク結果
 * @param name ラベル名（大文字小文字無視）
 * @returns バイトアドレス
 * @throws 見つからないとき
 */
export function lookupByteAddr(image: LinkedImage, name: string): number {
  const key = name.toUpperCase();
  const g = image.globalBytes.get(key);
  if (g !== undefined) {
    return g;
  }
  throw new Error(`Global symbol not found: ${name}`);
}
