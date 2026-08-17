import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SDLD_AREA_BASES } from "./areaOrder";

/**
 * sdld リンク結果（IHX アドレスはバイト）。
 */
export interface SdldLinkResult {
  /** Intel HEX（バイトアドレス） */
  hexText: string;
  /** `L:G$name$0$0:hex` と `L:__CP$name$serial:hex` */
  cdbText: string;
  /** sdld `-m` のマップ全文（最終パス。バイトアドレス） */
  mapText: string;
  /** HEX をロードしたバイトイメージ */
  image: Uint8Array;
  /** シンボル → バイトアドレス（`l_*` はバイト長） */
  defs: Map<string, number>;
}

/** R3_BYTE */
const R3_BYTE = 0x01;
/** R3_SYM */
const R3_SYM = 0x02;

/**
 * sdld 実行ファイルを探す。
 * @returns 絶対パス
 * @throws 見つからない
 */
export function findSdld(): string {
  const envBin = process.env.SDLD?.trim();
  if (envBin && fs.existsSync(envBin)) return envBin;
  const dir = process.env.SDCC_BIN_DIR?.trim();
  if (dir) {
    const p = path.join(dir, "sdld");
    if (fs.existsSync(p)) return p;
  }
  const home = path.join(
    os.homedir(),
    "sdcc-mn1613/sdcc/build/sdcc/bin/sdld",
  );
  if (fs.existsSync(home)) return home;
  const which = spawnSync("which", ["sdld"], { encoding: "utf8" });
  const w = (which.stdout ?? "").trim();
  if (which.status === 0 && w && fs.existsSync(w)) return w;
  throw new Error(
    "sdld が見つかりません。`make sdcc-setup` するか SDCC_BIN_DIR / SDLD を設定してください",
  );
}

/**
 * Intel HEX 1 レコードのチェックサム（2 の補数）。
 * @param bytes 長さ・アドレス・種別・データ
 * @returns 0–255
 */
function hexChecksum(bytes: number[]): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return (~sum + 1) & 0xff;
}

/**
 * Intel HEX をパースする。
 * @param text IHX 全文
 * @returns アドレス → データバイト
 */
export function parseIntelHex(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(":")) continue;
    const buf = Buffer.from(line.slice(1), "hex");
    if (buf.length < 5) continue;
    const len = buf[0]!;
    const addr = (buf[1]! << 8) | buf[2]!;
    const type = buf[3]!;
    if (type !== 0) continue;
    for (let i = 0; i < len; i += 1) {
      out.set(addr + i, buf[4 + i]!);
    }
  }
  return out;
}

/**
 * バイトマップを Intel HEX テキストにする。
 * @param bytes アドレス → 値
 * @returns IHX
 */
export function bytesToIntelHex(bytes: Map<number, number>): string {
  const addrs = [...bytes.keys()].sort((a, b) => a - b);
  const lines: string[] = [];
  let i = 0;
  while (i < addrs.length) {
    const start = addrs[i]!;
    const chunk: number[] = [];
    let a = start;
    while (i < addrs.length && addrs[i] === a && chunk.length < 16) {
      chunk.push(bytes.get(a)!);
      i += 1;
      a += 1;
    }
    const rec = [chunk.length, (start >> 8) & 0xff, start & 0xff, 0, ...chunk];
    rec.push(hexChecksum(rec));
    lines.push(
      `:${rec.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")}`,
    );
  }
  lines.push(":00000001FF");
  return `${lines.join("\n")}\n`;
}

/**
 * HEX バイトマップを密な Uint8Array にする。
 * @param bytes 疎なバイト
 * @returns 0..maxAddr の配列
 */
export function hexBytesToImage(bytes: Map<number, number>): Uint8Array {
  let max = -1;
  for (const a of bytes.keys()) if (a > max) max = a;
  if (max < 0) return new Uint8Array(0);
  const img = new Uint8Array(max + 1);
  for (const [a, b] of bytes) img[a] = b;
  return img;
}

/**
 * sdld の .map からシンボル値を読む（16 進アドレス＋名前）。
 * @param mapText .map 全文
 * @returns 名前 → リンカ単位の値
 */
export function parseSdldMapSymbols(mapText: string): Map<string, number> {
  const defs = new Map<string, number>();
  const re = /\b([0-9A-Fa-f]{4,8})\s+([A-Za-z_.][A-Za-z0-9_.$]*)\b/g;
  for (const line of mapText.split(/\r?\n/)) {
    if (/^Area\b/i.test(line) || /^-+/.test(line)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[2]!;
      if (name === "Area" || name === "Addr" || name === "Size") continue;
      defs.set(name, parseInt(m[1]!, 16) >>> 0);
    }
  }
  return defs;
}

/**
 * マップの名前を大小無視で探す。
 * @param defs マップ
 * @param name 名前
 * @returns 値。無ければ undefined
 */
function defLookup(defs: Map<string, number>, name: string): number | undefined {
  const exact = defs.get(name);
  if (exact !== undefined) return exact;
  const upper = name.toUpperCase();
  for (const [k, v] of defs) {
    if (k.toUpperCase() === upper) return v;
  }
  return undefined;
}

/**
 * リンカ単位の Def を CDB テキストにする。
 * @param defs 名前 → バイトアドレス
 * @returns CDB
 */
export function defsToCdbFromSdld(defs: Map<string, number>): string {
  const names = [...defs.keys()].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const name of names) {
    if (/^__CP[0-9]{4}$/i.test(name)) continue;
    const val = defs.get(name)! >>> 0;
    const hex = val.toString(16).toUpperCase();
    const cp = name.match(/^__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})$/);
    if (cp) {
      lines.push(`L:${name}:${hex}`);
      continue;
    }
    lines.push(`L:G$${name}$0$0:${hex}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/**
 * `.lnk` 本文を組み立てる。配置は SDCC 付属の sdld が行う。
 * @param relPaths 入力 .rel（先頭が MAIN）
 * @param extraB 追加 `-b`（領域 → バイトアドレス）。1 本目の map を見て渡す
 * @param outName `-o` の基点
 * @returns lnk テキスト
 */
export function buildSdldLnk(
  relPaths: string[],
  extraB: Record<string, number> = {},
  outName = "out",
  presentAreas?: Set<string>,
): string {
  const lines = ["-i", "-m", "-y", "-w", `-o ${outName}`];
  for (const [area, addr] of Object.entries(SDLD_AREA_BASES)) {
    if (presentAreas && !presentAreas.has(area)) continue;
    if (Object.prototype.hasOwnProperty.call(extraB, area)) continue;
    lines.push(`-b ${area} = 0x${addr.toString(16).toUpperCase()}`);
  }
  for (const [area, addr] of Object.entries(extraB)) {
    if (presentAreas && !presentAreas.has(area)) continue;
    lines.push(`-b ${area} = 0x${addr.toString(16).toUpperCase()}`);
  }
  for (const p of relPaths) {
    lines.push(p);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * sdld を 1 回起動する。
 * @param sdld sdld パス
 * @param workDir 作業ディレクトリ（.ihx/.map/.cdb の基点）
 * @param outBase 拡張子なし出力名
 * @param lnkText .lnk 本文
 */
function runSdldOnce(
  sdld: string,
  workDir: string,
  outBase: string,
  lnkText: string,
): void {
  const lnkPath = path.join(workDir, `${outBase}.lnk`);
  fs.writeFileSync(lnkPath, lnkText, "utf8");
  const r = spawnSync(sdld, ["-f", lnkPath], {
    encoding: "utf8",
    cwd: workDir,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(`sdld failed (exit ${r.status}): ${err || "no output"}`);
  }
}

type RelocItem = { mode: number; rtp: number; index: number };

type RelChunk = {
  areaName: string;
  tAddr: number;
  data: number[];
  items: RelocItem[];
};

type ParsedRel = {
  areas: string[];
  areaSizes: Map<string, number>;
  symbols: string[];
  chunks: RelChunk[];
};

/**
 * asxxxx REL から T/R とシンボル表を読む（MN161x ワード÷2 用）。
 * @param text REL 全文
 * @returns 領域・シンボル・T/R
 */
function parseRelChunks(text: string): ParsedRel {
  const areas: string[] = [];
  const areaSizes = new Map<string, number>();
  const symbols: string[] = [];
  const chunks: RelChunk[] = [];
  let pendingT: { tAddr: number; data: number[] } | null = null;
  let currentArea = "_CODE";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0]!;
    if (tag === "A") {
      currentArea = parts[1] ?? "_CODE";
      areas.push(currentArea);
      const sizeIdx = parts.indexOf("size");
      const size = sizeIdx >= 0 ? parseInt(parts[sizeIdx + 1] ?? "0", 16) : 0;
      areaSizes.set(currentArea, size);
      continue;
    }
    if (tag === "S") {
      symbols.push(parts[1] ?? "");
      continue;
    }
    if (tag === "T") {
      const nums = parts.slice(1).map((p) => parseInt(p, 16));
      pendingT = {
        tAddr: ((nums[0] ?? 0) << 8) | (nums[1] ?? 0),
        data: nums.slice(2),
      };
      continue;
    }
    if (tag === "R" && pendingT) {
      const nums = parts.slice(1).map((p) => parseInt(p, 16));
      const areaIdx = ((nums[2] ?? 0) << 8) | (nums[3] ?? 0);
      const items: RelocItem[] = [];
      for (let i = 4; i + 3 < nums.length; i += 4) {
        items.push({
          mode: nums[i]!,
          rtp: nums[i + 1]!,
          index: (nums[i + 2]! << 8) | nums[i + 3]!,
        });
      }
      chunks.push({
        areaName: areas[areaIdx] ?? currentArea,
        tAddr: pendingT.tAddr,
        data: pendingT.data,
        items,
      });
      pendingT = null;
    }
  }
  return { areas, areaSizes, symbols, chunks };
}

/**
 * 各 .rel の領域開始（このモジュール分）を CON 累積で求める。
 * @param rels パース済み REL（リンク順）
 * @param defs sdld マップ
 * @returns rel ごと・領域名 → バイト開始
 */
function moduleAreaBases(
  rels: ParsedRel[],
  defs: Map<string, number>,
): Array<Map<string, number>> {
  const cursor = new Map<string, number>();
  const seed = (area: string, fallback: number): void => {
    cursor.set(
      area,
      defLookup(defs, `s_${area}`) ?? SDLD_AREA_BASES[area] ?? fallback,
    );
  };
  seed("_BIOS", 0);
  seed("_CODE", 0);
  seed("_DATA", defLookup(defs, "s__CODE") ?? 0);
  seed("_WORK", defLookup(defs, "s__DATA") ?? 0);
  seed("_SYS_PAGE0", SDLD_AREA_BASES._SYS_PAGE0 ?? 0);
  seed("_USR_PAGE0", SDLD_AREA_BASES._USR_PAGE0 ?? 0);
  seed("_VECTOR", 0);

  const out: Array<Map<string, number>> = [];
  for (const rel of rels) {
    const thisBase = new Map<string, number>();
    for (const area of rel.areas) {
      if (!cursor.has(area)) {
        seed(area, 0);
      }
      thisBase.set(area, cursor.get(area) ?? 0);
      if (area !== "_VECTOR") {
        cursor.set(
          area,
          ((cursor.get(area) ?? 0) + (rel.areaSizes.get(area) ?? 0)) >>> 0,
        );
      }
    }
    out.push(thisBase);
  }
  return out;
}

/**
 * 16bit BE を読む。
 * @param bytes 疎なイメージ
 * @param addr バイトアドレス
 * @returns 値
 */
function read16be(bytes: Map<number, number>, addr: number): number {
  return (((bytes.get(addr) ?? 0) << 8) | (bytes.get(addr + 1) ?? 0)) & 0xffff;
}

/**
 * 16bit BE を書く。
 * @param bytes 疎なイメージ
 * @param addr バイトアドレス
 * @param val 値
 */
function write16be(bytes: Map<number, number>, addr: number, val: number): void {
  bytes.set(addr, (val >> 8) & 0xff);
  bytes.set(addr + 1, val & 0xff);
}

/**
 * sdld が足したバイトアドレスを MN161x のワードアドレスへ直す。
 * R3_WORD は 16bit を ÷2。R3_BYTE（`*label`）はシンボル／領域のワード下位 8bit。
 * @param bytes IHX の疎マップ
 * @param relPaths 入力 .rel
 * @param defs sdld マップ
 */
function applyMn1613WordAddrFixup(
  bytes: Map<number, number>,
  relPaths: string[],
  defs: Map<string, number>,
): void {
  const parsedRels = relPaths.map((p) =>
    parseRelChunks(fs.readFileSync(p, "utf8")),
  );
  const bases = moduleAreaBases(parsedRels, defs);
  parsedRels.forEach((parsed, relIdx) => {
    const thisBase = bases[relIdx]!;
    for (const chunk of parsed.chunks) {
      const areaBase = thisBase.get(chunk.areaName) ?? 0;
      for (const item of chunk.items) {
        const fieldOff = chunk.tAddr + (item.rtp - 2);
        const absAddr = (areaBase + fieldOff) >>> 0;
        if ((item.mode & R3_BYTE) !== 0) {
          if ((item.mode & R3_SYM) !== 0) {
            const symName = parsed.symbols[item.index] ?? "";
            const symVal = defLookup(defs, symName) ?? 0;
            bytes.set(absAddr, (symVal >>> 1) & 0xff);
          } else {
            const srcArea = parsed.areas[item.index] ?? chunk.areaName;
            const srcBase =
              thisBase.get(srcArea) ??
              defLookup(defs, `s_${srcArea}`) ??
              SDLD_AREA_BASES[srcArea] ??
              0;
            const orig = chunk.data[item.rtp - 2] ?? 0;
            bytes.set(absAddr, ((srcBase + orig) >>> 1) & 0xff);
          }
        } else {
          const val = read16be(bytes, absAddr);
          write16be(bytes, absAddr, (val >>> 1) & 0xffff);
        }
      }
    }
  });
}

/**
 * .rel を SDCC 付属の `sdld` でリンクする。MN161x はバイト単位でリンクし、
 * 命令のアドレス欄だけワードへ直す。配置は sdld。`_BIOS` の続きへ `_CODE` を
 * 置く `-b` と `_DATA` / `_WORK` は 1 本目の map を見て 2 本目の `.lnk` に書く
 * （sdld8051 が空の `_CODE` を先に作るため、1 本では `_BIOS` の後ろに付かない）。
 * @param relPaths 入力 .rel（MAIN を先頭にすること）
 * @param options wordAddrFixup=false なら TMS（÷2 しない）
 * @returns リンク結果
 */
export function linkRelsWithSdld(
  relPaths: string[],
  options?: {
    wordAddrFixup?: boolean;
    workDir?: string;
    outName?: string;
  },
): SdldLinkResult {
  if (relPaths.length === 0) {
    throw new Error("linkRelsWithSdld: no .rel inputs");
  }
  const wordAddrFixup = options?.wordAddrFixup !== false;
  const sdld = findSdld();
  const workDir =
    options?.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "sdld-link-"));
  const outName = options?.outName ?? "out";
  fs.mkdirSync(workDir, { recursive: true });

  const absRels = relPaths.map((p) => path.resolve(p));
  const presentAreas = new Set<string>();
  for (const p of absRels) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^A\s+(\S+)/.exec(line);
      if (m) presentAreas.add(m[1]!);
    }
  }
  runSdldOnce(
    sdld,
    workDir,
    outName,
    buildSdldLnk(absRels, {}, outName, presentAreas),
  );

  const mapPath = path.join(workDir, `${outName}.map`);
  let mapText = fs.existsSync(mapPath)
    ? fs.readFileSync(mapPath, "utf8")
    : "";
  let defs = parseSdldMapSymbols(mapText);
  const extraB: Record<string, number> = {};
  const codeLen = defLookup(defs, "l__CODE") ?? defLookup(defs, "l_CODE") ?? 0;
  let codeStart =
    defLookup(defs, "s__CODE") ?? defLookup(defs, "s_CODE") ?? 0;
  if (presentAreas.has("_BIOS") && presentAreas.has("_CODE")) {
    const biosStart =
      defLookup(defs, "s__BIOS") ?? defLookup(defs, "s_BIOS") ?? 0;
    const biosLen =
      defLookup(defs, "l__BIOS") ?? defLookup(defs, "l_BIOS") ?? 0;
    extraB._CODE = (biosStart + biosLen) >>> 0;
    codeStart = extraB._CODE;
  }
  if (presentAreas.has("_DATA")) {
    extraB._DATA = (codeStart + codeLen) >>> 0;
  }
  const dataLen = defLookup(defs, "l__DATA") ?? defLookup(defs, "l_DATA") ?? 0;
  const dataStart =
    extraB._DATA ?? defLookup(defs, "s__DATA") ?? defLookup(defs, "s_DATA");
  if (presentAreas.has("_WORK") && dataStart !== undefined) {
    extraB._WORK = (dataStart + dataLen) >>> 0;
  } else if (presentAreas.has("_WORK")) {
    extraB._WORK = (codeStart + codeLen) >>> 0;
  }
  if (Object.keys(extraB).length > 0) {
    runSdldOnce(
      sdld,
      workDir,
      outName,
      buildSdldLnk(absRels, extraB, outName, presentAreas),
    );
    mapText = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, "utf8") : "";
    defs = parseSdldMapSymbols(mapText);
  }

  const rawIhxPath = path.join(workDir, `${outName}.ihx`);
  if (!fs.existsSync(rawIhxPath)) {
    throw new Error(`sdld did not write ${rawIhxPath}`);
  }
  const bytes = parseIntelHex(fs.readFileSync(rawIhxPath, "utf8"));
  if (wordAddrFixup) {
    applyMn1613WordAddrFixup(bytes, absRels, defs);
  }
  const hexText = bytesToIntelHex(bytes);
  const cdbText = defsToCdbFromSdld(defs);
  const image = hexBytesToImage(bytes);
  return { hexText, cdbText, mapText, image, defs };
}
