/**
 * `; @cp <name>` チェックポイントの注入と CDB 行生成
 * 根拠: asm_editor.mdc / asm_test_framework.mdc
 */

/** CDB / ログに出す 1 件分（アセンブララベルではない） */
export type CheckpointEmit = {
  /** ソースのチェックポイント名（大文字化しない） */
  name: string;
  /** 同名識別用 4 桁（0001 開始） */
  serial: string;
  /**
   * 結び先命令のアドレス解決用アンカー（`__CP0001` 形式）。
   * 同一命令に複数 `@cp` があっても 1 つだけ。CDB の `__CP$name$serial` とは別。
   */
  anchorName: string;
};

/** モジュール横断の連番状態 */
export type CheckpointInjectState = {
  /** 名前 → 次に振る番号（1 起算） */
  byName: Map<string, number>;
  /** ユニークラベル用連番 */
  unique: number;
  emitted: CheckpointEmit[];
};

const CP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 半角 `@` と全角 `＠`（IME） */
const CP_AT = "[@\\uFF20]";
const CP_ONLY = new RegExp(`^\\s*;\\s*${CP_AT}cp(?:\\s+(.*))?$`);
const CP_TRAIL = new RegExp(`;\\s*${CP_AT}cp(?:\\s+(.*))?$`);
const SYNTHETIC_GLOBAL = /^__CP[0-9]{4}$/i;

/** 命令を出さない疑似命令（チェックポイントの結び先から除外） */
const SKIP_PSEUDO = new Set([
  "cpu",
  "area",
  "org",
  "include",
  "equ",
  "globl",
  "global",
  "macro",
  "endm",
  "if",
  "else",
  "endif",
  "ifdef",
  "ifndef",
  "list",
  "nlist",
  "module",
]);

/**
 * 注入状態を初期化する。
 * @returns 空の連番状態
 */
export function createCheckpointState(): CheckpointInjectState {
  return { byName: new Map(), unique: 0, emitted: [] };
}

/**
 * CDB / ログ用のチェックポイント ID。
 * `@cp` 自体はラベルではない。同名は serial で区別する。
 * @param name `; @cp` の名前
 * @param serial 同名 4 桁（0001 起算）
 * @returns `__CP$gl_get_rnd$0001`
 */
export function checkpointId(name: string, serial: string): string {
  return `__CP$${name}$${serial}`;
}

/**
 * リンカ defs / CDB の L:G から除外する合成グローバルか。
 * @param name シンボル名
 * @returns `__CP0001` または `__CP$name$serial` なら true
 */
export function isSyntheticCheckpointGlobal(name: string): boolean {
  return SYNTHETIC_GLOBAL.test(name) || /^__CP\$/i.test(name);
}

/**
 * コメントのみ／空行か。
 * @param line 1 行
 * @returns 空または `;` 始まりなら true
 */
function isCommentOrBlank(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith(";");
}

/**
 * チェックポイントの結び先にしない行か（`.cpu` / `.area` など）。
 * @param line 1 行
 * @returns スキップするなら true
 */
function isSkipDirective(line: string): boolean {
  const withoutLabel = line.replace(
    /^\s*[A-Za-z_.$][A-Za-z0-9_.$]*:\s*/,
    "",
  );
  const body = withoutLabel.trim();
  if (!body || body.startsWith(";")) return true;
  const m = body.match(/^\.([A-Za-z]+)/);
  if (!m) return false;
  return SKIP_PSEUDO.has(m[1]!.toLowerCase());
}

/**
 * `; @cp name` から名前を取る。不正なら例外。
 * @param raw コメント内の名前トークン
 * @returns 検証済み名前
 */
function requireCpName(raw: string | undefined): string {
  const name = (raw ?? "").trim();
  if (!CP_NAME.test(name)) {
    throw new Error(
      `invalid checkpoint name "${name || raw || ""}" (; @cp は英数字と _ のみ、先頭は英字/_ )`,
    );
  }
  return name;
}

/**
 * 1 件分のチェックポイントを発行する（ラベルではない。serial は同名ごと）。
 * @param state 連番状態
 * @param name チェックポイント名
 * @returns 発行レコード
 */
function allocCheckpoint(
  state: CheckpointInjectState,
  name: string,
): CheckpointEmit {
  const next = (state.byName.get(name) ?? 0) + 1;
  state.byName.set(name, next);
  const emit: CheckpointEmit = {
    name,
    serial: next.toString().padStart(4, "0"),
    anchorName: "",
  };
  state.emitted.push(emit);
  return emit;
}

/**
 * 同一命令用のアドレスアンカーを 1 つ発行する。
 * @param state 連番状態
 * @returns `__CP0001` 形式
 */
function allocAnchor(state: CheckpointInjectState): string {
  state.unique += 1;
  if (state.unique > 9999) {
    throw new Error("too many checkpoint anchors (serial overflow)");
  }
  return `__CP${state.unique.toString().padStart(4, "0")}`;
}

/**
 * 合成 `.globl` + ラベル行（アドレス解決用。チェックポイント名ではない）。
 * @param anchor `__CP0001` 形式
 * @returns 挿入テキスト（末尾改行なし）
 */
function syntheticAnchorBlock(anchor: string): string {
  return `\t.globl\t${anchor}\n${anchor}:`;
}

/**
 * `; @cp` の直後（または同一行）の命令へ、アドレス解決用アンカーを 1 つ挿入する。
 * @param sourceText expandIncludes 後のソース
 * @param state モジュール横断の連番
 * @returns 注入後ソース
 */
export function injectCheckpoints(
  sourceText: string,
  state: CheckpointInjectState,
): string {
  const nl = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines = sourceText.split(/\r?\n/);
  const out: string[] = [];
  let pending: CheckpointEmit[] = [];

  /**
   * 保留中のチェックポイントをこの行の直前に出す。
   * @param targetLine 結び先の行
   */
  const flushPending = (targetLine: string): void => {
    if (pending.length > 0) {
      const anchor = allocAnchor(state);
      for (const emit of pending) {
        emit.anchorName = anchor;
      }
      out.push(syntheticAnchorBlock(anchor));
      pending = [];
    }
    out.push(targetLine);
  };

  for (const line of lines) {
    const only = line.match(CP_ONLY);
    if (only) {
      pending.push(allocCheckpoint(state, requireCpName(only[1]!)));
      out.push(line);
      continue;
    }

    const trail = line.match(CP_TRAIL);
    if (trail && !isCommentOrBlank(line)) {
      pending.push(allocCheckpoint(state, requireCpName(trail[1]!)));
      if (isSkipDirective(line)) {
        out.push(line);
        continue;
      }
      flushPending(line);
      continue;
    }

    if (pending.length > 0 && (isCommentOrBlank(line) || isSkipDirective(line))) {
      out.push(line);
      continue;
    }

    if (pending.length > 0) {
      flushPending(line);
      continue;
    }

    out.push(line);
  }

  if (pending.length > 0) {
    const names = pending.map((p) => p.name).join(", ");
    throw new Error(`checkpoint has no following instruction: ${names}`);
  }

  return out.join(nl);
}

/**
 * リンク済みバイトアドレスから CDB `__CP$` 行を作る。
 * @param emitted inject で発行した一覧
 * @param defs リンカグローバル（バイトアドレス。キーは大文字）
 * @returns CDB テキスト（末尾改行あり。0 件なら空文字）
 */
export function checkpointsToCdb(
  emitted: CheckpointEmit[],
  defs: Map<string, number>,
): string {
  if (emitted.length === 0) return "";
  const lines: string[] = [];
  for (const cp of emitted) {
    const byteAddr =
      defs.get(cp.anchorName.toUpperCase()) ?? defs.get(cp.anchorName);
    if (byteAddr === undefined) {
      throw new Error(
        `checkpoint anchor not in linker defs: ${cp.anchorName} (${checkpointId(cp.name, cp.serial)})`,
      );
    }
    const hex = (byteAddr >>> 0).toString(16).toUpperCase();
    lines.push(`L:${checkpointId(cp.name, cp.serial)}:${hex}`);
  }
  return `${lines.join("\n")}\n`;
}
