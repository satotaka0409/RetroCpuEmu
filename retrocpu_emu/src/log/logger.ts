/**
 * IO ボードのログ出力（Winston）
 *
 * メインプロセス / IO Worker / CPU Worker がそれぞれ初期化し、同じ log ディレクトリへ書く。
 * ファイルは 1 行 1 JSON レコードなので、スレッドが混在しても行単位で読める。
 * 初期化前・テスト時はコンソールのみ（ファイルを作らない）。
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import winston from "winston";

/** ログの発生元（プロセス／スレッド） */
export type LogSource = "main" | "io" | "cpu";

export type LogInitOptions = {
  source: LogSource;
  /** 指定時のみファイル出力を追加 */
  dir?: string;
  level?: string;
  /** 結合ログのファイル名 */
  fileName?: string;
};

const IS_TEST =
  process.env.VITEST !== undefined || process.env.NODE_ENV === "test";

const DEFAULT_LEVEL =
  process.env.RETROCPU_LOG_LEVEL ?? (IS_TEST ? "error" : "info");

const META_HIDDEN_KEYS = new Set([
  "level",
  "message",
  "timestamp",
  "scope",
  "src",
  "stack",
]);

let currentSource: LogSource = "main";
let currentLogFile: string | null = null;
const fileTransports: winston.transports.FileTransportInstance[] = [];

/**
 * メタ値をコンソール表示用の文字列にする。
 * 0xFF を超える整数は 16 進にする（アドレスやレジスタ値が読みやすいため）。
 * @param value 任意の値
 * @returns 表示用文字列
 */
function formatMetaValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) > 0xff
      ? `0x${(value >>> 0).toString(16)}`
      : String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * ログレコードの付加情報を `key=値` の並びにする。
 * @param info ログレコード（level / message 等の予約キーは除外する）
 * @returns 先頭に空白の付いた文字列。付加情報が無ければ空文字
 */
function formatMeta(info: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(info)) {
    if (META_HIDDEN_KEYS.has(key) || value === undefined) continue;
    parts.push(`${key}=${formatMetaValue(value)}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

const withSource = winston.format((info) => {
  info.src = currentSource;
  return info;
})();

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.printf((info) => {
    const rec = info as unknown as Record<string, unknown>;
    const time = String(rec.timestamp ?? "");
    const level = String(rec.level ?? "info").toUpperCase().padEnd(5);
    const scope = String(rec.scope ?? rec.src ?? currentSource);
    const stack = typeof rec.stack === "string" ? `\n${rec.stack}` : "";
    return `${time} ${level} [${scope}] ${String(rec.message)}${formatMeta(rec)}${stack}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const consoleTransport = new winston.transports.Console({
  silent: IS_TEST,
  format: consoleFormat,
});

const root = winston.createLogger({
  level: DEFAULT_LEVEL,
  format: withSource,
  transports: [consoleTransport],
});

/**
 * ログの発生元とファイル出力先を設定する。
 * Electron メイン・各 Worker の起動時に 1 回だけ呼ぶ。
 * `dir` 未指定ならコンソールのみ（ファイルを作らない）。
 */
export function initLogging(options: LogInitOptions): void {
  currentSource = options.source;
  root.level = options.level ?? DEFAULT_LEVEL;

  for (const t of fileTransports) root.remove(t);
  fileTransports.length = 0;
  currentLogFile = null;

  if (!options.dir) return;

  mkdirSync(options.dir, { recursive: true });
  const combined = path.join(options.dir, options.fileName ?? "ioboard.log");
  currentLogFile = combined;

  fileTransports.push(
    new winston.transports.File({
      filename: combined,
      format: fileFormat,
      maxsize: 2 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(options.dir, "ioboard-error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  );
  for (const t of fileTransports) root.add(t);
}

/** 用途別のロガー（scope はコンソール出力の `[...]` に出る） */
export function getLogger(scope: string): winston.Logger {
  return root.child({ scope });
}

/**
 * 出力レベルを実行中に変更する。
 * @param level winston のレベル名（error / warn / info / debug など）
 */
export function setLogLevel(level: string): void {
  root.level = level;
}

/** 結合ログのパス（ファイル出力なしなら null） */
export function getLogFilePath(): string | null {
  return currentLogFile;
}
