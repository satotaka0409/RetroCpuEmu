import net from "node:net";

/** VS Code 側が扱うデバッグ TCP コマンド */
export const VS_DEBUG_CMD = {
  BREAK_SET: 0x80,
  BREAK_CLR: 0x81,
  MEM_READ: 0x83,
  MEM_WRITE: 0x84,
} as const;

/** デバッグ TCP 応答ステータス */
export const VS_DEBUG_STATUS = {
  OK: 0x00,
  NG: 0x01,
} as const;

/** 80h アドレス/IO ブレイク設定 */
export type VsBreakSet = {
  slot: number;
  flags: number;
  count: number;
  addr: number;
  data: number;
};

/**
 * VS Code 側相当の最小 TCP クライアント。
 * 1 接続を維持し、要求は直列化して順序を保証する。
 */
export class VsDebugClient {
  private sock: net.Socket | null = null;
  private recvBuf = Buffer.alloc(0);
  private pending: Array<{
    need: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }> = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  /**
   * TCP 接続を確立する。
   * @param timeoutMs タイムアウト
   */
  async connect(timeoutMs = 2000): Promise<void> {
    if (this.sock && !this.sock.destroyed) return;
    this.sock = null;
    this.recvBuf = Buffer.alloc(0);
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      const t = setTimeout(() => {
        sock.destroy();
        reject(new Error(`connect timeout ${this.host}:${this.port}`));
      }, timeoutMs);

      sock.once("connect", () => {
        clearTimeout(t);
        this.sock = sock;
        sock.on("data", (chunk: Buffer) => {
          this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
          this.flushPending();
        });
        sock.on("close", () => {
          this.failPending(new Error("socket closed"));
          this.sock = null;
        });
        sock.on("error", (e: Error) => {
          this.failPending(e);
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
    this.failPending(new Error("socket closed"));
  }

  /**
   * 80h ブレイク設定。
   * @param req 設定内容
   * @returns status
   */
  breakSet(req: VsBreakSet): Promise<number> {
    const frame = Uint8Array.from([
      VS_DEBUG_CMD.BREAK_SET,
      req.slot & 0xff,
      req.flags & 0xff,
      req.count & 0xff,
      (req.addr >>> 24) & 0xff,
      (req.addr >>> 16) & 0xff,
      (req.addr >>> 8) & 0xff,
      req.addr & 0xff,
      (req.data >>> 8) & 0xff,
      req.data & 0xff,
    ]);
    return this.sendStatusOnly(frame);
  }

  /**
   * 81h ブレイク解除。
   * @param slot 0-7
   * @returns status
   */
  breakClear(slot: number): Promise<number> {
    return this.sendStatusOnly(
      Uint8Array.from([VS_DEBUG_CMD.BREAK_CLR, slot & 0xff]),
    );
  }

  /**
   * 84h メモリ書き込み。
   * @param byteAddr バイトアドレス
   * @param data 書き込むデータ
   * @returns status
   */
  memWrite(byteAddr: number, data: Uint8Array): Promise<number> {
    const n = data.byteLength >>> 0;
    const frame = new Uint8Array(9 + n);
    frame[0] = VS_DEBUG_CMD.MEM_WRITE;
    frame[1] = (byteAddr >>> 24) & 0xff;
    frame[2] = (byteAddr >>> 16) & 0xff;
    frame[3] = (byteAddr >>> 8) & 0xff;
    frame[4] = byteAddr & 0xff;
    frame[5] = (n >>> 24) & 0xff;
    frame[6] = (n >>> 16) & 0xff;
    frame[7] = (n >>> 8) & 0xff;
    frame[8] = n & 0xff;
    frame.set(data, 9);
    return this.sendStatusOnly(frame);
  }

  /**
   * 83h メモリ読み出し。
   * @param byteAddr バイトアドレス
   * @param byteCount 読み出しバイト数
   * @returns 受信データ
   */
  memRead(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.connect();
      const sock = this.sock;
      if (!sock) throw new Error("not connected");
      const frame = Uint8Array.from([
        VS_DEBUG_CMD.MEM_READ,
        (byteAddr >>> 24) & 0xff,
        (byteAddr >>> 16) & 0xff,
        (byteAddr >>> 8) & 0xff,
        byteAddr & 0xff,
        (byteCount >>> 24) & 0xff,
        (byteCount >>> 16) & 0xff,
        (byteCount >>> 8) & 0xff,
        byteCount & 0xff,
      ]);
      sock.write(Buffer.from(frame));

      const st = await this.readExact(1);
      if (st[0] !== VS_DEBUG_STATUS.OK) {
        throw new Error(`memRead NG status=${st[0]}`);
      }
      const lenBuf = await this.readExact(4);
      const m =
        ((lenBuf[0]! << 24) |
          (lenBuf[1]! << 16) |
          (lenBuf[2]! << 8) |
          lenBuf[3]!) >>>
        0;
      if (m === 0) return new Uint8Array(0);
      const data = await this.readExact(m);
      return Uint8Array.from(data);
    };

    const p = this.chain.then(run, run);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private sendStatusOnly(frame: Uint8Array): Promise<number> {
    const run = async (): Promise<number> => {
      await this.connect();
      const sock = this.sock;
      if (!sock) throw new Error("not connected");
      sock.write(Buffer.from(frame));
      const st = await this.readExact(1);
      return st[0] ?? VS_DEBUG_STATUS.NG;
    };

    const p = this.chain.then(run, run);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private readExact(n: number, timeoutMs = 10000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`read timeout ${n} bytes`));
      }, timeoutMs);
      this.pending.push({
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
      this.flushPending();
    });
  }

  private flushPending(): void {
    while (
      this.pending.length > 0 &&
      this.recvBuf.length >= this.pending[0]!.need
    ) {
      const p = this.pending.shift()!;
      const out = this.recvBuf.subarray(0, p.need);
      this.recvBuf = this.recvBuf.subarray(p.need);
      p.resolve(Buffer.from(out));
    }
  }

  private failPending(e: Error): void {
    const list = this.pending.splice(0, this.pending.length);
    for (const p of list) p.reject(e);
  }
}
