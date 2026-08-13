/**
 * CPU ボード CPLD 相当のアドレス比較器（8 本）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc（IO 0030–0033）/
 *       HandShake.mdc / retrocpu_debug.mdc（比較器ブレイク）
 *
 * 一致時は呼び出し側が INT2・要因 4 を上げる（本モジュールはヒット判定とレジスタのみ）。
 */

/** 比較器本数（ユーザ 0–5 + ステップ 6–7） */
export const CPLD_COMPARATOR_COUNT = 8;

/** IO:0030 — スロット選択と ENA / MEM·IO / RD·WR */
export const IO_PORT_BREAK_CTRL = 0x0030;
/** IO:0031 — アドレス bit0–15 */
export const IO_PORT_BREAK_ADDR_LO = 0x0031;
/** IO:0032 — アドレス bit16–17（下位 2bit） */
export const IO_PORT_BREAK_ADDR_HI = 0x0032;
/** IO:0033 — 直近に一致した比較器番号（CPU 読取） */
export const IO_PORT_BREAK_HIT = 0x0033;

/** Bit5–6: READ のみ */
export const BREAK_RDWR_RD = 0b01;
/** Bit5–6: WRITE のみ */
export const BREAK_RDWR_WR = 0b10;
/** Bit5–6: READ/WRITE 両方 */
export const BREAK_RDWR_BOTH = 0b11;

export type AddrComparatorSlot = {
  /** 有効なら true */
  enabled: boolean;
  /** true=IO、false=MEM */
  io: boolean;
  /** Bit5–6 の値（01/10/11）。00 はアクセス種別不一致 */
  rdwr: number;
  /** 監視する 18bit 物理ワードアドレス（MEM）または IO ポート下位 */
  addr: number;
};

export type AddrBusAccess = {
  /** MEM なら 18bit 物理ワード、IO ならポート番号 */
  addr: number;
  /** true=IO 空間 */
  io: boolean;
  /** true=WRITE、false=READ */
  write: boolean;
};

/**
 * 制御ワード（IO:0030）からスロット設定を取り出す。
 * @param ctrl 16bit 制御値
 * @returns slot / enabled / io / rdwr
 */
export function decodeBreakCtrl(ctrl: number): {
  slot: number;
  enabled: boolean;
  io: boolean;
  rdwr: number;
} {
  return {
    slot: ctrl & 0x07,
    enabled: ((ctrl >>> 3) & 1) === 1,
    io: ((ctrl >>> 4) & 1) === 1,
    rdwr: (ctrl >>> 5) & 0x03,
  };
}

/**
 * スロット設定を IO:0030 用の制御ワードにする。
 * @param slot 比較器番号 0–7
 * @param enabled ENABLE
 * @param io true=IO
 * @param rdwr 01/10/11
 * @returns 制御ワード
 */
export function encodeBreakCtrl(
  slot: number,
  enabled: boolean,
  io: boolean,
  rdwr: number,
): number {
  return (
    (slot & 0x07) |
    ((enabled ? 1 : 0) << 3) |
    ((io ? 1 : 0) << 4) |
    ((rdwr & 0x03) << 5)
  );
}

/**
 * アクセスがスロット設定に一致するか。
 * @param slot スロット
 * @param access バスアクセス
 * @returns 一致なら true
 */
export function slotMatches(
  slot: AddrComparatorSlot,
  access: AddrBusAccess,
): boolean {
  if (!slot.enabled) return false;
  if (slot.io !== access.io) return false;
  const rdwr = slot.rdwr & 0x03;
  if (rdwr === 0) return false;
  if (access.write) {
    if ((rdwr & BREAK_RDWR_WR) === 0) return false;
  } else if ((rdwr & BREAK_RDWR_RD) === 0) {
    return false;
  }
  if (access.io) {
    return (slot.addr & 0xffff) === (access.addr & 0xffff);
  }
  return (slot.addr & 0x3ffff) === (access.addr & 0x3ffff);
}

/**
 * 8 本のアドレス比較器。IO 0030–0033 で設定・取得する。
 */
export class AddrComparatorBank {
  private readonly slots: AddrComparatorSlot[];
  /** 直近に WT した制御ワード（選択スロットのエコー元） */
  private ctrlLatch = 0;
  private addrLoLatch = 0;
  private addrHiLatch = 0;
  /** 直近ヒットしたスロット。無しは 0xFFFF */
  private lastHit = 0xffff;
  /** ヒット時コールバック（INT2 要因4 など） */
  private onHit: ((slot: number) => void) | null = null;

  /** 8 スロットを無効で初期化する */
  constructor() {
    this.slots = Array.from({ length: CPLD_COMPARATOR_COUNT }, () => ({
      enabled: false,
      io: false,
      rdwr: 0,
      addr: 0,
    }));
  }

  /**
   * ヒット時の通知先を登録する。
   * @param cb 一致したスロット番号を受け取る。null で解除
   */
  setOnHit(cb: ((slot: number) => void) | null): void {
    this.onHit = cb;
  }

  /** 全スロットを無効化しラッチをクリアする */
  reset(): void {
    for (const s of this.slots) {
      s.enabled = false;
      s.io = false;
      s.rdwr = 0;
      s.addr = 0;
    }
    this.ctrlLatch = 0;
    this.addrLoLatch = 0;
    this.addrHiLatch = 0;
    this.lastHit = 0xffff;
  }

  /**
   * スロット内容を返す（コピー）。
   * @param slot 0–7
   * @returns スロット。範囲外は undefined
   */
  getSlot(slot: number): AddrComparatorSlot | undefined {
    if (slot < 0 || slot >= CPLD_COMPARATOR_COUNT) return undefined;
    const s = this.slots[slot]!;
    return { enabled: s.enabled, io: s.io, rdwr: s.rdwr, addr: s.addr };
  }

  /**
   * スロットを直接設定する（テスト／内部用）。
   * @param slot 0–7
   * @param cfg 設定
   */
  setSlot(slot: number, cfg: AddrComparatorSlot): void {
    if (slot < 0 || slot >= CPLD_COMPARATOR_COUNT) return;
    const s = this.slots[slot]!;
    s.enabled = cfg.enabled;
    s.io = cfg.io;
    s.rdwr = cfg.rdwr & 0x03;
    s.addr = cfg.addr & 0x3ffff;
  }

  /**
   * 直近に一致した比較器番号を返す。
   * @returns 0–7。未ヒットは 0xFFFF
   */
  getLastHit(): number {
    return this.lastHit;
  }

  /**
   * バスアクセスを全スロットと照合する。最初に一致したスロットでヒットする。
   * @param access MEM/IO・RD/WR
   * @returns ヒットしたスロット。無しは -1
   */
  probe(access: AddrBusAccess): number {
    for (let i = 0; i < CPLD_COMPARATOR_COUNT; i += 1) {
      if (slotMatches(this.slots[i]!, access)) {
        this.lastHit = i;
        this.onHit?.(i);
        return i;
      }
    }
    return -1;
  }

  /**
   * IO リード（0030–0033）。
   * @param port ポート番号
   * @returns 16bit。対象外は null
   */
  readPort(port: number): number | null {
    const p = port & 0xffff;
    if (p === IO_PORT_BREAK_CTRL) {
      return this.ctrlFromSelected();
    }
    if (p === IO_PORT_BREAK_ADDR_LO) {
      return this.addrLoFromSelected();
    }
    if (p === IO_PORT_BREAK_ADDR_HI) {
      return this.addrHiFromSelected();
    }
    if (p === IO_PORT_BREAK_HIT) {
      return this.lastHit === 0xffff ? 0xffff : this.lastHit & 0x07;
    }
    return null;
  }

  /**
   * IO ライト（0030–0032）。0030 書込でスロットへ適用する。
   * @param port ポート番号
   * @param val 16bit
   * @returns 処理したら true
   */
  writePort(port: number, val: number): boolean {
    const p = port & 0xffff;
    const v = val & 0xffff;
    if (p === IO_PORT_BREAK_ADDR_LO) {
      this.addrLoLatch = v;
      this.applyAddrToSelected();
      return true;
    }
    if (p === IO_PORT_BREAK_ADDR_HI) {
      this.addrHiLatch = v & 0x03;
      this.applyAddrToSelected();
      return true;
    }
    if (p === IO_PORT_BREAK_CTRL) {
      this.ctrlLatch = v;
      this.applyCtrlToSlot();
      return true;
    }
    if (p === IO_PORT_BREAK_HIT) {
      return true;
    }
    return false;
  }

  /**
   * 制御ラッチのスロット番号（Bit0–2）。
   * @returns 0–7
   */
  private selectedSlot(): number {
    return this.ctrlLatch & 0x07;
  }

  /** 選択スロットへ制御ラッチを書き込む */
  private applyCtrlToSlot(): void {
    const d = decodeBreakCtrl(this.ctrlLatch);
    const s = this.slots[d.slot]!;
    s.enabled = d.enabled;
    s.io = d.io;
    s.rdwr = d.rdwr;
    s.addr =
      ((this.addrHiLatch & 0x03) << 16) | (this.addrLoLatch & 0xffff);
  }

  /** 選択スロットのアドレスだけ更新する（31/32 書込時） */
  private applyAddrToSelected(): void {
    const slot = this.selectedSlot();
    const s = this.slots[slot]!;
    s.addr =
      ((this.addrHiLatch & 0x03) << 16) | (this.addrLoLatch & 0xffff);
  }

  /**
   * 選択スロットの制御ワードを組む。
   * @returns 0030 相当
   */
  private ctrlFromSelected(): number {
    const slot = this.selectedSlot();
    const s = this.slots[slot]!;
    return encodeBreakCtrl(slot, s.enabled, s.io, s.rdwr);
  }

  /**
   * 選択スロットのアドレス下位。
   * @returns 0031 相当
   */
  private addrLoFromSelected(): number {
    return this.slots[this.selectedSlot()]!.addr & 0xffff;
  }

  /**
   * 選択スロットのアドレス上位 2bit。
   * @returns 0032 相当
   */
  private addrHiFromSelected(): number {
    return (this.slots[this.selectedSlot()]!.addr >>> 16) & 0x03;
  }
}

/** CPU ボード共有の比較器バンク */
export const addrComparators = new AddrComparatorBank();
