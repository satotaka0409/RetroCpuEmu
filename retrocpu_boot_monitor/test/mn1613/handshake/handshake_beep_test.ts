/**
 * g_bios_beep（CPU→IO コマンド 19h）
 * 根拠: HandShake.mdc「BEEP音」/ boot_monitor.mdc / test_framework.mdc
 *
 * 正常系はホストで実際に音を鳴らす（WSL なら Windows Console.Beep）。
 */
import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import {
  mn1613MonHandshakeSettings,
  withMn1613CpuLog,
} from "../mn1613_mon_settings.js";

const BASE_REGS = {
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

/** 結合テストで鳴らす周波数 Hz */
const BEEP_HZ = 880;
/** 結合テストで鳴らす長さ ms */
const BEEP_MS = 200;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * g_main 済み＋ ioMock handshake で 1 ケースを実行する。
 * @param fn 本体（session / mock 利用可）
 */
async function withCase(
  fn: (s: Mn1613AsmSession, mock: IoBoardHandshakeMock) => Promise<void>,
): Promise<void> {
  session.reload();
  try {
    await session.runInit();
    await fn(session, session.requireHandshakeMock());
  } finally {
    await session.detachIoMock();
  }
}

/**
 * g_bios_beep を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param frequencyHz 周波数 Hz（R0）
 * @param durationMs 長さ ms（R1）
 */
async function callBeep(
  mock: IoBoardHandshakeMock,
  frequencyHz: number,
  durationMs: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_beep", {
      registers: { ...BASE_REGS, R0: frequencyHz, R1: durationMs },
    }),
    mock.handleOneRequest(),
  ]);
}

/**
 * コマンドを起動し、exit 0 なら true。
 * @param cmd 実行ファイル
 * @param args 引数
 */
function trySpawn(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", () => {
      resolve(false);
    });
    p.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * 16bit PCM モノラル WAV（サイン波）を作る。
 * @param frequencyHz 周波数 Hz
 * @param durationMs 長さ ms
 * @param sampleRate 標本化周波数 Hz
 * @returns WAV バイト列
 */
function sineWav(
  frequencyHz: number,
  durationMs: number,
  sampleRate = 22050,
): Buffer {
  const n = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i += 1) {
    const s = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
    buf.writeInt16LE(Math.round(s * 0.35 * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * ホストで BEEP を鳴らす（WSL→Windows Console.Beep、だめなら paplay/aplay）。
 * 再生手段が無いときは何もしない。
 * @param frequencyHz 周波数 Hz（0 以下なら無音）
 * @param durationMs 長さ ms（0 以下なら無音）
 */
async function playHostBeep(
  frequencyHz: number,
  durationMs: number,
): Promise<void> {
  if (frequencyHz <= 0 || durationMs <= 0) return;
  const freq = Math.max(37, Math.min(32767, frequencyHz | 0));
  const dur = Math.max(1, durationMs | 0);
  if (
    await trySpawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      `[console]::beep(${freq},${dur})`,
    ])
  ) {
    return;
  }
  const tmp = path.join(os.tmpdir(), `retrocpu-beep-${process.pid}.wav`);
  writeFileSync(tmp, sineWav(freq, dur));
  try {
    if (await trySpawn("paplay", [tmp])) return;
    if (await trySpawn("aplay", ["-q", tmp])) return;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

test("880Hz・200ms が IO ボードへ届きホストでも鳴る", async () => {
  await withCase(async (s, mock) => {
    await callBeep(mock, BEEP_HZ, BEEP_MS);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.lastBeep).toEqual({
      frequencyHz: BEEP_HZ,
      durationMs: BEEP_MS,
    });
    await playHostBeep(BEEP_HZ, BEEP_MS);
  });
});

test("周波数 0 は停止指示として届く", async () => {
  await withCase(async (s, mock) => {
    await callBeep(mock, 0, 100);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.lastBeep).toEqual({
      frequencyHz: 0,
      durationMs: 100,
    });
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callBeep(mock, BEEP_HZ, BEEP_MS);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    await playHostBeep(BEEP_HZ, BEEP_MS);
  });
});
