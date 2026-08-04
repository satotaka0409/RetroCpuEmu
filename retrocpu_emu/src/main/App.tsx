import { useEffect, useMemo, useState } from "react";
import { HexKeyboard } from "./components/HexKeyboard";
import { Led, type LedColor } from "./components/DisplayView/Led/Led";
import { SevenSegment } from "./components/DisplayView/SevenSegmentLed/SevenSegment";
import {
  getSnapshot,
  startEmuLoop,
  stopEmuLoop,
  subscribeEmu,
  type EmuSnapshot,
} from "./feature/board/emu_loop";
import {
  reset,
  setPins,
  startRun,
  step,
  requestHalt,
  getExecStatus,
} from "./feature/cpu/mn1613/mn1613";

type CpuStatusItem = {
  label: string;
  active: boolean;
  color: LedColor;
};

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function toDigits(hex: string, width: number): string[] {
  const s = hex.toUpperCase().padStart(width, "0").slice(-width);
  return s.split("");
}

function App() {
  const [snap, setSnap] = useState<EmuSnapshot>(() => getSnapshot());
  const [log, setLog] = useState<string[]>([
    "[boot] emulator loop ready",
  ]);

  useEffect(() => {
    startEmuLoop({ cpuStepsPerFrame: 32, uiEveryFrames: 1 });
    const unsub = subscribeEmu(setSnap);
    return () => {
      unsub();
      stopEmuLoop();
    };
  }, []);

  const pushLog = (msg: string) => {
    const t = new Date().toISOString().slice(11, 23);
    setLog((prev) => [`[${t}] ${msg}`, ...prev].slice(0, 40));
  };

  const icDigits = useMemo(
    () => toDigits(hex4(snap.regs.IC), 4),
    [snap.regs.IC],
  );
  const dataDigits = useMemo(
    () => toDigits(hex4(snap.regs.R[0] ?? 0), 4),
    [snap.regs.R],
  );

  const cpuStatus: CpuStatusItem[] = [
    { label: "HALT", active: snap.pins.HLT || snap.status === "halted", color: "red" },
    { label: "RESET", active: snap.pins.RST, color: "blue" },
    { label: "RUN", active: snap.pins.RUN, color: "orange" },
    { label: "IOP", active: snap.pins.IOP, color: "yellow" },
    { label: "WRT", active: snap.pins.WRT, color: "red" },
    { label: "IRQ0", active: snap.pins.IRQ0, color: "blue" },
    { label: "IRQ1", active: snap.pins.IRQ1, color: "blue" },
  ];

  const cpuRegisters = [
    { name: "STR", value: `0x${hex4(snap.regs.STR)}` },
    { name: "R0", value: `0x${hex4(snap.regs.R[0] ?? 0)}` },
    { name: "R1", value: `0x${hex4(snap.regs.R[1] ?? 0)}` },
    { name: "R2", value: `0x${hex4(snap.regs.R[2] ?? 0)}` },
    { name: "R3", value: `0x${hex4(snap.regs.R[3] ?? 0)}` },
    { name: "R4", value: `0x${hex4(snap.regs.R[4] ?? 0)}` },
    { name: "IC/PC", value: `0x${hex4(snap.regs.IC)}` },
    { name: "SP", value: `0x${hex4(snap.regs.SP)}` },
    { name: "STATUS", value: snap.status },
  ];

  const debugBlueLeds = Array.from({ length: 8 }, (_, i) =>
    ((snap.regs.STR >> i) & 1) !== 0,
  );
  const debugRedLeds = Array.from({ length: 8 }, (_, i) =>
    ((snap.regs.R[0] >> i) & 1) !== 0,
  );

  const onReset = () => {
    setPins({ RST: true });
    setPins({ RST: false });
    reset();
    pushLog("RESET pulsed");
    setSnap(getSnapshot());
  };

  const onRun = () => {
    setPins({ HLT: false });
    startRun();
    pushLog(`RUN status=${getExecStatus()}`);
    setSnap(getSnapshot());
  };

  const onStep = () => {
    setPins({ HLT: false });
    step();
    pushLog(`STEP IC=0x${hex4(getSnapshot().regs.IC)}`);
    setSnap(getSnapshot());
  };

  const onHalt = () => {
    requestHalt();
    setPins({ HLT: true });
    pushLog("HALT");
    setSnap(getSnapshot());
  };

  return (
    <div className="emu-shell">
      <header className="emu-header panel">
        <h1>MN1613 Emulator Control</h1>
        <div className="header-controls">
          <button className="control-pill" type="button" onClick={onHalt}>
            HALT
          </button>
          <button className="control-pill" type="button" onClick={onRun}>
            RUN
          </button>
          <button className="control-pill" type="button" onClick={onStep}>
            STEP
          </button>
          <button className="control-pill danger" type="button" onClick={onReset}>
            RESET
          </button>
        </div>
      </header>

      <main className="emu-main">
        <section className="left-panel panel">
          <h2>Hex Keyboard / 8-Digit LED</h2>
          <div className="led-stack">
            <section className="led-card">
              <h3>8-Digit Seven Segment LED</h3>
              <div className="led-bank-split">
                <div className="led-group">
                  <div className="led-bank">
                    {icDigits.map((digit, idx) => (
                      <SevenSegment
                        key={`pc-${digit}-${idx}`}
                        value={digit}
                        color="#ff3b1f"
                        backgroundColor="#1a0d0b"
                        width={34}
                        height={72}
                        thickness={7}
                      />
                    ))}
                  </div>
                  <span className="led-caption">IC</span>
                </div>
                <div className="led-group">
                  <div className="led-bank">
                    {dataDigits.map((digit, idx) => (
                      <SevenSegment
                        key={`data-${digit}-${idx}`}
                        value={digit}
                        color="#ff3b1f"
                        backgroundColor="#1a0d0b"
                        width={34}
                        height={72}
                        thickness={7}
                      />
                    ))}
                  </div>
                  <span className="led-caption">R0</span>
                </div>
              </div>
            </section>

            <section className="led-card">
              <h3>16 Debug LEDs</h3>
              <div className="debug-leds-wrap">
                <div className="debug-led-group">
                  <span className="debug-label">STR.lo</span>
                  <div className="debug-led-row">
                    {debugBlueLeds.map((on, idx) => (
                      <Led key={`blue-${idx}`} on={on} color="blue" size={12} />
                    ))}
                  </div>
                </div>
                <div className="debug-led-group">
                  <span className="debug-label">R0.lo</span>
                  <div className="debug-led-row">
                    {debugRedLeds.map((on, idx) => (
                      <Led key={`red-${idx}`} on={on} color="red" size={12} />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="led-card">
              <h3>CPU Status LEDs</h3>
              <div className="cpu-led-grid">
                {cpuStatus.map((item) => (
                  <div className="cpu-led-item" key={item.label}>
                    <span className="cpu-led-label">{item.label}</span>
                    <Led
                      on={item.active}
                      color={item.color}
                      size={11}
                      className="cpu-led"
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
          <HexKeyboard />
        </section>

        <section className="right-panel">
          <section className="panel status-panel">
            <h2>Register / CPU State</h2>
            <div className="register-grid">
              {cpuRegisters.map((reg) => (
                <div className="register-row" key={reg.name}>
                  <span className="register-name">{reg.name}</span>
                  <span className="register-value">{reg.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel memory-panel">
            <div className="memory-header">
              <h2>Memory Viewer</h2>
              <span className="memory-range">near IC</span>
            </div>
            <div className="memory-table">
              <div className="memory-head-row">
                <span>ADDR</span>
                <span>HEX (words)</span>
                <span>ASCII</span>
              </div>
              {snap.memRows.map((row) => (
                <div className="memory-row" key={row.addr}>
                  <span>{row.addr}</span>
                  <span>{row.hex}</span>
                  <span>{row.ascii}</span>
                </div>
              ))}
            </div>
          </section>
        </section>
      </main>

      <footer className="emu-footer panel">
        <h2>System Log / Debug Console</h2>
        <div className="log-window">
          {log.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </footer>
    </div>
  );
}

export default App;
