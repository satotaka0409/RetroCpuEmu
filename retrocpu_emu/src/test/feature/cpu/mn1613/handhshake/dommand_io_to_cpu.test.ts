/**
 * ハンドシェイク シーケンステスト
 *
 * 参照文書: .github/HandShake.md
 *
 * 対象:
 *   RetroCpuHandshake  (handshake_retrocpu.ts) ── CPU ボード側
 *   IoControlHandshake (handshake_ioboard.ts)  ── I/O ボード側
 *
 * テスト戦略:
 *   共有バスオブジェクトを使い、両側を Promise.all で同時実行する。
 *   waitCondition は setTimeout(0) でポーリングするため、
 *   同一 JS イベントループ内で両側が交互に進行できる。
 *
 * 注: このファイル名 "dommand_io_to_cpu.test.ts" は typo（正: command）。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RetroCpuHandshake } from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_retrocpu";
import { IoControlHandshake } from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_ioboard";
import type { CpuIoSignals } from "../../../../../main/feature/cpu/mn1613/mn1613ioport";
import {
  createHandshakeBus,
  INT_CAUSE_CODE,
} from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_type";

// ─────────────────────────────────────────────
// テストユーティリティ
// ─────────────────────────────────────────────

/** バス信号の遷移履歴を記録するプロキシを生成する */
function createSpyBus(): { bus: CpuIoSignals; log: string[] } {
  const log: string[] = [];
  const raw = createHandshakeBus();
  const bus = new Proxy(raw, {
    set(target, key, value) {
      const prev = (target as unknown as Record<string, number>)[key as string];
      (target as unknown as Record<string, number>)[key as string] =
        value as number;
      if (prev !== value) {
        log.push(`${String(key)}: ${prev}→${value}`);
      }
      return true;
    },
  });
  return { bus: bus as CpuIoSignals, log };
}

// ─────────────────────────────────────────────
// 1. CPU→IO: データ転送
// ─────────────────────────────────────────────
describe("CPU→IO データ転送（HandShake.md CPU→IO シーケンス）", () => {
  let bus: CpuIoSignals;
  let cpu: RetroCpuHandshake;
  let io: IoControlHandshake;

  beforeEach(() => {
    bus = createHandshakeBus();
    cpu = new RetroCpuHandshake(bus, 200);
    io = new IoControlHandshake(bus, 200);
  });

  it("1バイト転送", async () => {
    const sent = new Uint8Array([0xab]);
    const [, received] = await Promise.all([cpu.send(sent), io.receive(1)]);
    expect(received).toEqual(sent);
  });

  it("複数バイト転送（4バイト）", async () => {
    const sent = new Uint8Array([0x10, 0x11, 0x12, 0x13]);
    const [, received] = await Promise.all([cpu.send(sent), io.receive(4)]);
    expect(received).toEqual(sent);
  });

  it("奇数バイト転送（3バイト）", async () => {
    const sent = new Uint8Array([0xde, 0xad, 0xbe]);
    const [, received] = await Promise.all([cpu.send(sent), io.receive(3)]);
    expect(received).toEqual(sent);
  });

  it("長いデータ転送（16バイト）", async () => {
    const sent = new Uint8Array(Array.from({ length: 16 }, (_, i) => i));
    const [, received] = await Promise.all([cpu.send(sent), io.receive(16)]);
    expect(received).toEqual(sent);
  });

  it("全ゼロバイト列を転送できる", async () => {
    const sent = new Uint8Array([0x00, 0x00, 0x00]);
    const [, received] = await Promise.all([cpu.send(sent), io.receive(3)]);
    expect(received).toEqual(sent);
  });

  it("全 0xFF バイト列を転送できる", async () => {
    const sent = new Uint8Array([0xff, 0xff, 0xff]);
    const [, received] = await Promise.all([cpu.send(sent), io.receive(3)]);
    expect(received).toEqual(sent);
  });
});

// ─────────────────────────────────────────────
// 2. IO→CPU: データ転送
// ─────────────────────────────────────────────
describe("IO→CPU データ転送（HandShake.md IO→CPU シーケンス）", () => {
  let bus: CpuIoSignals;
  let cpu: RetroCpuHandshake;
  let io: IoControlHandshake;

  beforeEach(() => {
    bus = createHandshakeBus();
    cpu = new RetroCpuHandshake(bus, 200);
    io = new IoControlHandshake(bus, 200);
  });

  it("1バイト受信", async () => {
    const sent = new Uint8Array([0xca]);
    const [, received] = await Promise.all([io.send(sent), cpu.receive(1)]);
    expect(received).toEqual(sent);
  });

  it("複数バイト受信（5バイト）", async () => {
    const sent = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const [, received] = await Promise.all([io.send(sent), cpu.receive(5)]);
    expect(received).toEqual(sent);
  });

  it("奇数バイト受信（3バイト）", async () => {
    const sent = new Uint8Array([0xde, 0xad, 0xbe]);
    const [, received] = await Promise.all([io.send(sent), cpu.receive(3)]);
    expect(received).toEqual(sent);
  });

  it("長いデータ受信（16バイト）", async () => {
    const sent = new Uint8Array(Array.from({ length: 16 }, (_, i) => 0xff - i));
    const [, received] = await Promise.all([io.send(sent), cpu.receive(16)]);
    expect(received).toEqual(sent);
  });
});

// ─────────────────────────────────────────────
// 3. バス信号シーケンス検証
// ─────────────────────────────────────────────
describe("バス信号シーケンス検証", () => {
  it("CPU→IO: HSHK_REQ_0=1 の後に HSHK_ACK=1 が来てから HSHK_REQ_0=0 になる", async () => {
    const { bus, log } = createSpyBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([cpu.send(new Uint8Array([0x01])), io.receive(1)]);

    const req0Rise = log.indexOf("HSHK_REQ_0: 0→1");
    const ackRise = log.indexOf("HSHK_ACK: 0→1");
    const req0Fall = log.indexOf("HSHK_REQ_0: 1→0");
    expect(req0Rise).toBeGreaterThanOrEqual(0);
    expect(ackRise).toBeGreaterThan(req0Rise);
    expect(req0Fall).toBeGreaterThan(ackRise);
  });

  it("CPU→IO: HSHK_DENA が 0→1→0 とトグルする（2バイト送信）", async () => {
    const { bus, log } = createSpyBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([cpu.send(new Uint8Array([0x01, 0x02])), io.receive(2)]);

    expect(log).toContain("HSHK_DENA: 0→1");
    expect(log).toContain("HSHK_DENA: 1→0");
  });

  it("IO→CPU: HSHK_REQ_1=1 の後に HSHK_ACK=1 が来てから HSHK_REQ_1=0 になる", async () => {
    const { bus, log } = createSpyBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([io.send(new Uint8Array([0x02])), cpu.receive(1)]);

    const req1Rise = log.indexOf("HSHK_REQ_1: 0→1");
    const ackRise = log.indexOf("HSHK_ACK: 0→1");
    const req1Fall = log.indexOf("HSHK_REQ_1: 1→0");
    expect(req1Rise).toBeGreaterThanOrEqual(0);
    expect(ackRise).toBeGreaterThan(req1Rise);
    expect(req1Fall).toBeGreaterThan(ackRise);
  });

  it("IO→CPU: INT_CAUSE が 2（ハンドシェイク）に設定される", async () => {
    const { bus, log } = createSpyBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([io.send(new Uint8Array([0xff])), cpu.receive(1)]);

    expect(log).toContain(`INT_CAUSE: 0→${INT_CAUSE_CODE.HANDSHAKE}`);
  });

  it("IO→CPU: HSHK_DENA がデータ送信前に 0 で初期化される（HSHK_REQ_1=1 前は HSHK_DENA 未変化）", async () => {
    const { bus, log } = createSpyBus();
    const io = new IoControlHandshake(bus, 200);
    const cpu = new RetroCpuHandshake(bus, 200);

    await Promise.all([io.send(new Uint8Array([0x05])), cpu.receive(1)]);

    const req1Rise = log.indexOf("HSHK_REQ_1: 0→1");
    expect(req1Rise).toBeGreaterThanOrEqual(0);

    const denaRiseBeforeReq = log
      .slice(0, req1Rise)
      .some((e) => e === "HSHK_DENA: 0→1");
    expect(denaRiseBeforeReq).toBe(false);
  });

  it("セッション完了後にバスが idle 状態（ACK=0, DENA=0）に戻る", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([cpu.send(new Uint8Array([0xaa, 0xbb])), io.receive(2)]);

    expect(bus.HSHK_ACK).toBe(0);
    expect(bus.HSHK_DENA).toBe(0);
    expect(bus.HSHK_REQ_0).toBe(0);
  });

  it("IO→CPU セッション完了後にバスが idle 状態（ACK=0, DENA=0）に戻る", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    await Promise.all([io.send(new Uint8Array([0xcc, 0xdd])), cpu.receive(2)]);

    expect(bus.HSHK_ACK).toBe(0);
    expect(bus.HSHK_DENA).toBe(0);
    expect(bus.HSHK_REQ_1).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 4. エラーハンドリング
// ─────────────────────────────────────────────
describe("エラーハンドリング", () => {
  it("CPU→IO: IO 側が応答しない場合は timeout エラー", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 50); // 50ms タイムアウト

    await expect(cpu.send(new Uint8Array([0x01]))).rejects.toThrow(
      "handshake timeout",
    );
  });

  it("IO→CPU: CPU 側が応答しない場合は timeout エラー", async () => {
    const bus = createHandshakeBus();
    const io = new IoControlHandshake(bus, 50);

    await expect(io.send(new Uint8Array([0x01]))).rejects.toThrow(
      "handshake timeout",
    );
  });

  it("IO→CPU: INT_CAUSE が 2 以外のとき受信側がエラーをスロー", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    // INT_CAUSE を強制的に不正値にしてから REQ_1 を立てる
    (bus as { INT_CAUSE: number }).INT_CAUSE = 99; // 不正な要因
    bus.HSHK_REQ_1 = 1;
    await expect(cpu.receive(1)).rejects.toThrow();
  });

  it("IO→CPU: セッション開始前に ACK=1 が残っている場合は待機する", async () => {
    const bus = createHandshakeBus();
    const io = new IoControlHandshake(bus, 200);

    // HSHK_ACK=1 を残した状態でセッション開始を試みる
    bus.HSHK_ACK = 1;

    // ACK=0 チェック（50us～100us × 最大10回）が失敗する
    await expect(io.send(new Uint8Array([0x01]))).rejects.toThrow(
      "handshake ACK0 check failed",
    );
  });
});

// ─────────────────────────────────────────────
// 5. 連続セッション（複数トランザクション）
// ─────────────────────────────────────────────
describe("連続セッション", () => {
  it("CPU→IO を 3回連続して実行できる", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    for (let i = 0; i < 3; i++) {
      const sent = new Uint8Array([i + 1]);
      const [, received] = await Promise.all([cpu.send(sent), io.receive(1)]);
      expect(received[0]).toBe(i + 1);
    }
  });

  it("IO→CPU を 3回連続して実行できる", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    for (let i = 0; i < 3; i++) {
      const sent = new Uint8Array([0x10 + i]);
      const [, received] = await Promise.all([io.send(sent), cpu.receive(1)]);
      expect(received[0]).toBe(0x10 + i);
    }
  });

  it("CPU→IO と IO→CPU を交互に実行できる", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    // CPU→IO
    const [, r1] = await Promise.all([
      cpu.send(new Uint8Array([0xaa])),
      io.receive(1),
    ]);
    expect(r1[0]).toBe(0xaa);

    // IO→CPU
    const [, r2] = await Promise.all([
      io.send(new Uint8Array([0xbb])),
      cpu.receive(1),
    ]);
    expect(r2[0]).toBe(0xbb);

    // CPU→IO
    const [, r3] = await Promise.all([
      cpu.send(new Uint8Array([0xcc])),
      io.receive(1),
    ]);
    expect(r3[0]).toBe(0xcc);
  });
});

// ─────────────────────────────────────────────
// 6. HandShake.md のコマンドシナリオ（結合テスト）
// ─────────────────────────────────────────────
describe("コマンドシナリオ（HandShake.md 準拠）", () => {
  it("CPU状態通知コマンド(0x10) を CPU→IO で送信できる", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    // コマンドバイト 0x10 を先頭に、続いてダミーのレジスタ値を送る
    const payload = new Uint8Array([
      0x10, // CPU_STATUS_NOTIFY コマンド
      0x12,
      0x34, // R0
      0x00,
      0x00, // R1
    ]);
    const [, received] = await Promise.all([
      cpu.send(payload),
      io.receive(payload.length),
    ]);
    expect(received[0]).toBe(0x10); // コマンドコードが正しい
    expect(received[1]).toBe(0x12);
    expect(received[2]).toBe(0x34);
  });

  it("実行指示コマンド(0x49) を IO→CPU で送信し OK 応答を返す", async () => {
    const bus = createHandshakeBus();
    const cpu = new RetroCpuHandshake(bus, 200);
    const io = new IoControlHandshake(bus, 200);

    // IO→CPU: コマンド送信
    const cmd = new Uint8Array([0x49, 0x00, 0x00, 0x01, 0x00]);
    const [, received] = await Promise.all([
      io.send(cmd),
      cpu.receive(cmd.length),
    ]);
    expect(received[0]).toBe(0x49);

    // CPU→IO: OK 応答
    const ok = new Uint8Array([0x00]);
    const [, ioRecv] = await Promise.all([cpu.send(ok), io.receive(1)]);
    expect(ioRecv[0]).toBe(0x00);
  });
});
