/**
 * JSDoc 未記載の関数／クラスメソッドを列挙する監査スクリプト
 *
 * 直前の非空行が `*\/` で終わっていない宣言を「未記載」として報告する。
 * 使い方: node scripts/jsdoc_audit.mjs [--list]
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { globSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = globSync("src/**/*.ts", { cwd: root }).sort();

/** 関数宣言 */
const RE_FUNCTION = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*[(<]/;
/** アロー／関数式を代入する const */
const RE_CONST_FN =
  /^\s*(export\s+)?const\s+([A-Za-z0-9_$]+)\s*(:[^=]+)?=\s*(async\s+)?(\([^)]*\)|[A-Za-z0-9_$]+)\s*(:[^=]*)?=>/;
/** クラスメソッド（get/set/constructor 含む）。制御構文や呼び出しは除く */
const RE_METHOD =
  /^\s{2,}(public\s+|private\s+|protected\s+)?(static\s+)?(readonly\s+)?(abstract\s+)?(async\s+)?(get\s+|set\s+)?(\*\s*)?([A-Za-z0-9_$]+)\s*(<[^>]*>)?\s*\([^;]*$/;
const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "await",
  "typeof",
  "new",
  "do",
  "else",
  "throw",
  "case",
  "yield",
  "function",
  "describe",
  "it",
  "test",
  "expect",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

let total = 0;
let missing = 0;
const report = [];

for (const rel of files) {
  const text = readFileSync(join(root, rel), "utf8");
  const lines = text.split("\n");
  let inClass = false;
  let classDepth = 0;
  let depth = 0;
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes("*/")) inComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inComment = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (/^\s*(export\s+)?(abstract\s+)?class\s/.test(line)) {
      inClass = true;
      classDepth = depth;
    }

    let name = null;
    let kind = null;
    const mFn = RE_FUNCTION.exec(line);
    const mConst = RE_CONST_FN.exec(line);
    if (mFn) {
      name = mFn[4];
      kind = "function";
    } else if (mConst) {
      name = mConst[2];
      kind = "const-fn";
    } else if (inClass && depth === classDepth + 1) {
      const mMethod = RE_METHOD.exec(line);
      if (mMethod && !KEYWORDS.has(mMethod[8])) {
        name = mMethod[8];
        kind = "method";
      }
    }

    if (name) {
      total++;
      let p = i - 1;
      while (p >= 0 && lines[p].trim() === "") p--;
      const prev = p >= 0 ? lines[p].trim() : "";
      if (!prev.endsWith("*/")) {
        missing++;
        report.push(`${relative(".", rel)}:${i + 1}\t${kind}\t${name}`);
      }
    }

    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (inClass && depth <= classDepth) inClass = false;
      }
    }
  }
}

if (process.argv.includes("--list")) {
  for (const r of report) console.log(r);
}
console.log(`total=${total} missing=${missing}`);
