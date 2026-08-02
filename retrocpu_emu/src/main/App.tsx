import { HexKeyboard } from "./components/HexKeyboard";
import { Led, type LedColor } from "./components/DisplayView/Led/Led";
import { SevenSegment } from "./components/DisplayView/SevenSegmentLed/SevenSegment";

const pcDigits = ["0", "1", "A", "0"];
const dataDigits = ["2", "3", "4", "5"];
const debugBlueLeds = new Array(8).fill(true);
const debugRedLeds = new Array(8).fill(true);

type CpuStatusItem = {
  label: string;
  active: boolean;
  color: LedColor;
};

const cpuStatus: CpuStatusItem[] = [
  { label: "HALT", active: true, color: "red" },
  { label: "RESET", active: false, color: "blue" },
  { label: "UNDEF", active: false, color: "white" },
  { label: "EXT", active: true, color: "orange" },
  { label: "SVC", active: false, color: "yellow" },
  { label: "ALU", active: false, color: "red" },
  { label: "BUS", active: false, color: "blue" },
];

const cpuRegisters = [
  { name: "STR", value: "0x00" },
  { name: "GR0", value: "0x1234" },
  { name: "GR1", value: "0x0000" },
  { name: "GR2", value: "0x00AF" },
  { name: "GR3", value: "0x0042" },
  { name: "IC/PC", value: "0x0200" },
  { name: "SP", value: "0x07F0" },
  { name: "FR", value: "NZVC=0010" },
];

const memoryRows = [
  { addr: "0200", hex: "12 34 56 78 9A BC DE F0", ascii: ".4Vx...." },
  { addr: "0208", hex: "00 11 22 33 44 55 66 77", ascii: '.."3DUfw' },
  { addr: "0210", hex: "4D 4E 31 36 31 30 00 FF", ascii: "MN1610.." },
  { addr: "0218", hex: "A0 A1 A2 A3 10 20 30 40", ascii: "..... 0@" },
];

function App() {
  return (
    <div className="emu-shell">
      <header className="emu-header panel">
        <h1>MN1610 Emulator Control</h1>
        <div className="header-controls">
          <button className="control-pill">POWER SW</button>
          <button className="control-pill">RUN</button>
          <button className="control-pill">STEP</button>
          <button className="control-pill danger">RESET</button>
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
                    {pcDigits.map((digit, idx) => (
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
                  <span className="led-caption">PC</span>
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
                  <span className="led-caption">DATA</span>
                </div>
              </div>
            </section>

            <section className="led-card">
              <h3>16 Debug LEDs</h3>
              <div className="debug-leds-wrap">
                <div className="debug-led-group">
                  <span className="debug-label">BLUE</span>
                  <div className="debug-led-row">
                    {debugBlueLeds.map((on, idx) => (
                      <Led key={`blue-${idx}`} on={on} color="blue" size={12} />
                    ))}
                  </div>
                </div>
                <div className="debug-led-group">
                  <span className="debug-label">RED</span>
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
              <h2>Memory / VRAM Viewer</h2>
              <span className="memory-range">0x0200 - 0x021F</span>
            </div>
            <div className="memory-table">
              <div className="memory-head-row">
                <span>ADDR</span>
                <span>HEX</span>
                <span>ASCII</span>
              </div>
              {memoryRows.map((row) => (
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
          <p>[00:00:00.001] POWER ON</p>
          <p>[00:00:00.110] ROM loaded: MONITOR.BIN</p>
          <p>[00:00:00.240] CPU halted at 0x0200</p>
          <p>[00:00:01.012] Ready.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
