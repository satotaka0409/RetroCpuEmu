/**
 * `; @cp` チェックポイント（アセンブララベルではない）
 * 根拠: asm_editer.mdc
 */

import type { AsmCheckpoint, EmittedWord, ParsedLine } from "./types";
import { canonicalAreaName } from "./areaOrder";

/** 半角 `@` と全角 `＠`（IME） */
const CP_AT = "[@\\uFF20]";
const CP_FIND = new RegExp(`;\\s*${CP_AT}cp(?:\\s+(\\S+))?`, "i");
const CP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 結び先にしない疑似命令 */
const SKIP_PSEUDO = new Set([
  "CPU",
  "AREA",
  "ORG",
  "INCLUDE",
  "EQU",
  "GLOBL",
  "GLOBAL",
  "MACRO",
  "ENDM",
  "IF",
  "ELSE",
  "ENDIF",
  "IFDEF",
  "IFNDEF",
  "LIST",
  "NLIST",
  "MODULE",
]);

/**
 * 1 行から `; @cp name` を取る。無ければ null。不正名は例外。
 * @param text 元行
 * @param lineNo 行番号
 * @returns 名前。無ければ null
 */
export function checkpointNameInLine(text: string, lineNo: number): string | null {
  const m = text.match(CP_FIND);
  if (!m) return null;
  const name = (m[1] ?? "").trim();
  if (!CP_NAME.test(name)) {
    throw new Error(
      `Line ${lineNo}: invalid checkpoint name "${name}" (; @cp は英数字と _ のみ、先頭は英字/_)`,
    );
  }
  return name;
}

/**
 * 命令／データ行か（チェックポイントの結び先）。
 * @param line 解析済み行
 * @returns 結び先なら true
 */
function isEmittingLine(line: ParsedLine): boolean {
  if (!line.op) return false;
  const op = line.op.toUpperCase().replace(/^\./, "");
  return !SKIP_PSEUDO.has(op);
}

/**
 * `; @cp` を次の命令／データに結び、領域内アドレスを付ける。
 * ラベルではない。同名は serial、同一ワードでも可。
 * @param parsed 解析済み行
 * @param words 出力語
 * @param storageAddrs `.ds` / `.blkw` 先頭
 * @param lineAreas 行ごとの領域
 * @returns チェックポイント一覧
 */
export function collectCheckpoints(
  parsed: ParsedLine[],
  words: EmittedWord[],
  storageAddrs: Map<number, number>,
  lineAreas: Map<number, string>,
): AsmCheckpoint[] {
  const pending: string[] = [];
  const bound: Array<{ name: string; targetLine: number }> = [];

  for (const line of parsed) {
    const cpName = checkpointNameInLine(line.text, line.lineNo);
    const emitting = isEmittingLine(line);
    if (cpName && emitting) {
      for (const name of pending) {
        bound.push({ name, targetLine: line.lineNo });
      }
      pending.length = 0;
      bound.push({ name: cpName, targetLine: line.lineNo });
      continue;
    }
    if (cpName) {
      pending.push(cpName);
      continue;
    }
    if (emitting && pending.length > 0) {
      for (const name of pending) {
        bound.push({ name, targetLine: line.lineNo });
      }
      pending.length = 0;
    }
  }

  if (pending.length > 0) {
    throw new Error(
      `checkpoint has no following instruction: ${pending.join(", ")}`,
    );
  }

  const byName = new Map<string, number>();
  const wordsByLine = new Map<number, EmittedWord>();
  for (const w of words) {
    if (!wordsByLine.has(w.lineNo)) wordsByLine.set(w.lineNo, w);
  }

  const out: AsmCheckpoint[] = [];
  for (const b of bound) {
    const next = (byName.get(b.name) ?? 0) + 1;
    byName.set(b.name, next);
    const word = wordsByLine.get(b.targetLine);
    const storage = storageAddrs.get(b.targetLine);
    let area: string;
    let address: number;
    if (word) {
      area = canonicalAreaName(word.area);
      address = word.address;
    } else if (storage !== undefined) {
      area = canonicalAreaName(lineAreas.get(b.targetLine) ?? "_CODE");
      address = storage;
    } else {
      throw new Error(
        `checkpoint "${b.name}" has no address at line ${b.targetLine}`,
      );
    }
    out.push({
      name: b.name,
      serial: next.toString().padStart(4, "0"),
      area,
      address,
    });
  }
  return out;
}

/**
 * CDB / REL 用 ID。
 * @param name `; @cp` 名
 * @param serial 4 桁
 * @returns `__CP$abcdefg$0001`
 */
export function checkpointId(name: string, serial: string): string {
  return `__CP$${name}$${serial}`;
}
