/**
 * VS Code UI 経由の HEX/CDB 読込。
 * 根拠: retrocpu_debug.mdc「プログラム読み込み」
 */

import * as fs from "node:fs";
import * as vscode from "vscode";
import type { DebugViewState } from "../panel/mockState";
import { ProgramSession } from "./programSession";

export { ProgramSession } from "./programSession";

/**
 * HEX（必須）と CDB（任意）を選んでセッションを作る。
 * 逆アセンブル先頭は `g_main`、無ければ HEX 最小アドレス。
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

  const state = session.toViewState();
  return { session, state };
}
