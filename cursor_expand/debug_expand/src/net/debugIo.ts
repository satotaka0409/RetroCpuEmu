/**
 * IO ボード DebugHost（TCP）へ 13h メモリ読み出しを送る。
 * IO がハンドシェイク 13h で CPU ボードへ問い合わせる。
 * 根拠: HandShake.mdc / retrocpu_debug.mdc（当面コマンド番号は線上と同じ）
 */

import net from "node:net";

/** メモリ読み出しコマンド（IO→CPU 13h） */
const CMD_MEM_READ = 0x13;

/** OK */
const STATUS_OK = 0x00;

/**
 * 13h 要求フレーム（cmd + addr32 BE + count32 BE）。
 * @param byteAddr 開始バイトアドレス
 * @param byteCount バイト数
 * @returns 9 バイト
 */
export function encodeMemReadFrame(
  byteAddr: number,
  byteCount: number,
): Uint8Array {
  const a = byteAddr >>> 0;
  const n = byteCount >>> 0;
  return Uint8Array.from([
    CMD_MEM_READ,
    (a >>> 24) & 0xff,
    (a >>> 16) & 0xff,
    (a >>> 8) & 0xff,
    a & 0xff,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

/**
 * DebugHost への TCP クライアント（接続を維持し、要求は直列）。
 */
export class DebugIoClient {
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private waiters: Array<{
    need: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }> = [];
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * @param host IO 待ち受けホスト
   * @param port IO 待ち受けポート（エミュ DebugHost は 29000）
   */
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  /**
   * 接続する（既にあれば何もしない）。
   * @param timeoutMs 接続タイムアウト
   */
  async connect(timeoutMs = 2000): Promise<void> {
    if (this.sock && !this.sock.destroyed) return;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      const t = setTimeout(() => {
        sock.destroy();
        reject(new Error(`debug TCP connect timeout ${this.host}:${this.port}`));
      }, timeoutMs);
      sock.once("connect", () => {
        clearTimeout(t);
        this.sock = sock;
        sock.on("data", (chunk: Buffer) => {
          this.buf = Buffer.concat([this.buf, chunk]);
          this.flushWaiters();
        });
        sock.on("close", () => {
          this.failWaiters(new Error("debug TCP closed"));
          this.sock = null;
        });
        sock.on("error", (e: Error) => {
          this.failWaiters(e);
        });
        resolve();
      });
      sock.once("error", (e: Error) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  /** 接続を閉じる */
  close(): void {
    this.sock?.destroy();
    this.sock = null;
    this.failWaiters(new Error("debug TCP closed"));
  }

  /**
   * ハンドシェイク 13h 相当でメモリを読む。
   * @param byteAddr 開始バイトアドレス（偶数）
   * @param byteCount バイト数
   * @returns データ
   */
  memRead(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.connect();
      const sock = this.sock;
      if (!sock) throw new Error("debug TCP not connected");
      sock.write(Buffer.from(encodeMemReadFrame(byteAddr, byteCount)));
      const st = await this.readExact(1, 15000);
      if (st[0] !== STATUS_OK) {
        throw new Error(`MEM_READ NG status=${st[0]}`);
      }
      const lenBuf = await this.readExact(4, 15000);
      const m =
        ((lenBuf[0]! << 24) |
          (lenBuf[1]! << 16) |
          (lenBuf[2]! << 8) |
          lenBuf[3]!) >>>
        0;
      if (m > 65536) throw new Error(`MEM_READ too large m=${m}`);
      if (m === 0) return new Uint8Array(0);
      const data = await this.readExact(m, 15000);
      return Uint8Array.from(data);
    };
    const p = this.chain.then(run, run);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  /**
   * 受信バッファから指定バイトを取る。
   * @param n バイト数
   * @param timeoutMs 待ち上限
   * @returns データ
   */
  private readExact(n: number, timeoutMs = 15000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`debug TCP read timeout (${n} bytes)`));
      }, timeoutMs);
      this.waiters.push({
        need: n,
        resolve: (b) => {
          clearTimeout(t);
          resolve(b);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.flushWaiters();
    });
  }

  /** 待ちを満たせるだけ進める */
  private flushWaiters(): void {
    while (this.waiters.length > 0 && this.buf.length >= this.waiters[0]!.need) {
      const w = this.waiters.shift()!;
      const slice = this.buf.subarray(0, w.need);
      this.buf = this.buf.subarray(w.need);
      w.resolve(Buffer.from(slice));
    }
  }

  /**
   * 待ち中の読みを失敗させる。
   * @param e エラー
   */
  private failWaiters(e: Error): void {
    const list = this.waiters.splice(0, this.waiters.length);
    for (const w of list) w.reject(e);
  }
}
