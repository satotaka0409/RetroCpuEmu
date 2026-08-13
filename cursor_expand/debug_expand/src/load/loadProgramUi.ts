/**
 * VS Code UI 経由の HEX/CDB 読込とソース検索。
 * 根拠: retrocpu_debug.mdc「プログラム読み込み」
 */

import * as fs from "node:fs";
import * as vscode from "vscode";
import type { DebugViewState } from "../panel/mockState";
import {
  entryLabelName,
  ProgramSession,
} from "./programSession";

export { ProgramSession } from "./programSession";
/**
 * ワークスペースからラベル定義のある .asm を探し、表示用ソースを返す。
 * @param label ラベル名（main / run 等）
 * @returns ソース情報。無ければ undefined
 */
export async function findSourceForLabel(
  label: string,
): Promise<{ path: string; lines: string[]; focusLine: number } | undefined> {
  const uris = await vscode.workspace.findFiles(
    "**/*.{asm,s,mn1613,mn1610}",
    "**/node_modules/**",
    200,
  );
  const re = new RegExp(
    `^\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:`,
    "i",
  );
  for (const uri of uris) {
    let text: string;
    try {
      text = fs.readFileSync(uri.fsPath, "utf8");
    } catch {
      continue;
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i]!)) {
        return {
          path: vscode.workspace.asRelativePath(uri),
          lines,
          focusLine: i + 1,
        };
      }
    }
  }
  return undefined;
}

/**
 * HEX（必須）と CDB（任意）を選んでセッションを作る。
 * @returns セッションと画面状態。キャンセル時 null
 */
export async function pickAndLoadProgram(): Promise<{
  session: ProgramSession;
  state: DebugViewState;
} | null> {
  const hexUri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Intel HEX を開く",
    filters: {
      "Intel HEX": ["ihx", "hex", "ihex"],
      すべて: ["*"],
    },
  });
  if (!hexUri?.[0]) return null;

  const hexPath = hexUri[0].fsPath;
  const hexText = fs.readFileSync(hexPath, "utf8");
  const session = new ProgramSession();
  session.loadHex(hexText, hexPath);

  const siblingCdb = hexPath.replace(/\.(ihx|hex|ihex)$/i, ".cdb");
  let cdbPath = "";
  if (fs.existsSync(siblingCdb)) {
    cdbPath = siblingCdb;
  } else {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "CDB を開く（スキップ可）",
      filters: { CDB: ["cdb"], すべて: ["*"] },
    });
    if (pick?.[0]) cdbPath = pick[0].fsPath;
  }
  if (cdbPath) {
    session.loadCdb(fs.readFileSync(cdbPath, "utf8"), cdbPath);
  }

  const label = entryLabelName(session);
  const source = label ? await findSourceForLabel(label) : undefined;
  const state = session.toViewState(source);
  return { session, state };
}
