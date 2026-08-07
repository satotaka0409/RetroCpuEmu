/**
 * ブラウザ UI = 1階 IO ボードの見た目のみ
 * レジスタ／メモリダンプ／ログ／CPU制御は Cursor 拡張側（WebSocket）の役割。
 */

import { useEffect, useMemo, useState } from "react";
import { HexKeyboard } from "./components/HexKeyboard";
import { Led } from "./components/DisplayView/Led/Led";
import { SevenSegment } from "./components/DisplayView/SevenSegmentLed/SevenSegment";
import {
  startEmuLoop,
  stopEmuLoop,
  subscribeEmu,
  type EmuSnapshot,
} from "./feature/board/emu_loop";
import { coldBootHaltStub } from "./feature/board/boot";
import { getMemory } from "./feature/cpu/mn1613/mn1613";

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function toDigits(hex: string, width: number): string[] {
  const s = hex.toUpperCase().padStart(width, "0").slice(-width);
  return s.split("");
}

function App() {
  const [snap, setSnap] = useState<EmuSnapshot | null>(null);
  /** 7セグ ADDRESS が指すワードアドレス（起動時は 0） */
  const [displayWordAddr] = useState(0);

  useEffect(() => {
    coldBootHaltStub();
    startEmuLoop({ cpuStepsPerFrame: 32, uiEveryFrames: 1 });
    const unsub = subscribeEmu(setSnap);
    return () => {
      unsub();
      stopEmuLoop();
    };
  }, []);

  const addrDigits = useMemo(
    () => toDigits((displayWordAddr & 0xffffffff).toString(16), 8),
    [displayWordAddr],
  );
  const dataDigits = useMemo(() => {
    void snap?.frame;
    const view = new DataView(getMemory());
    const off = (displayWordAddr & 0xffff) * 2;
    const word = off + 1 < view.byteLength ? view.getUint16(off, false) : 0;
    return toDigits(hex4(word), 4);
  }, [displayWordAddr, snap?.frame]);

  // 砲弾 LED 0〜F（暫定駆動）。HALT 時は右端(F)を点灯
  const bulletLeds = useMemo(() => {
    if (!snap) return Array.from({ length: 16 }, () => false);
    const lo = snap.regs.STR & 0xff;
    const hi = (snap.regs.R[0] ?? 0) & 0xff;
    const halted = snap.status === "halted" || snap.pins.HLT;
    return Array.from({ length: 16 }, (_, i) => {
      if (halted && i === 15) return true;
      const bit = i < 8 ? (lo >> i) & 1 : (hi >> (i - 8)) & 1;
      return bit !== 0;
    });
  }, [snap]);

  return (
    <div className="emu-shell io-board-shell">
      <header className="emu-header panel">
        <h1>IO Board</h1>
      </header>

      <main className="io-board-main panel">
        <div className="led-stack">
          <section className="led-card">
            <h3>7-Segment (ADDR 8 + DATA 4)</h3>
            <div className="led-bank-split">
              <div className="led-group">
                <div className="led-bank led-bank-addr">
                  {addrDigits.map((digit, idx) => (
                    <SevenSegment
                      key={`addr-${idx}`}
                      value={digit}
                      color="#ff3b1f"
                      backgroundColor="#1a0d0b"
                      width={28}
                      height={60}
                      thickness={6}
                    />
                  ))}
                </div>
                <span className="led-caption">ADDRESS</span>
              </div>
              <div className="led-group">
                <div className="led-bank">
                  {dataDigits.map((digit, idx) => (
                    <SevenSegment
                      key={`data-${idx}`}
                      value={digit}
                      color="#ff3b1f"
                      backgroundColor="#1a0d0b"
                      width={28}
                      height={60}
                      thickness={6}
                    />
                  ))}
                </div>
                <span className="led-caption">DATA</span>
              </div>
            </div>
          </section>

          <section className="led-card">
            <h3>Bullet LEDs (0–F)</h3>
            <div className="bullet-leds-wrap">
              <div className="bullet-led-row">
                {bulletLeds.map((on, idx) => (
                  <div className="bullet-led-item" key={`bullet-${idx}`}>
                    <span className="bullet-led-label">
                      {idx.toString(16).toUpperCase()}
                    </span>
                    <Led
                      on={on}
                      color={idx < 8 ? "red" : "orange"}
                      size={12}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <HexKeyboard />
      </main>
    </div>
  );
}

export default App;
