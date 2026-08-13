/**
 * Retro CPU Debug webview UI（retrocpu_debug.mdc 画面シェル）
 * 拡張本体から postMessage / 埋め込み __RETRO_DEBUG_STATE__ で状態を受け取る。
 */
(function () {
  const vscode = acquireVsCodeApi();

  /** @typedef {{ time:string,R0:string,R1:string,R2:string,R3:string,R4:string,IC:string,SP:string,STR:string,CSBR:string,SSBR:string,TSR0:string,TSR1:string,NPP:string,IISR:string,stack:string[] }} Regs */
  /** @typedef {any} State */

  /** @type {State} */
  let state = window.__RETRO_DEBUG_STATE__;

  /**
   * HTML エスケープ。
   * @param {string} s
   * @returns {string}
   */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 表示対象のレジスタを決める。
   * @returns {{ regs: Regs, meta: string, breakText: string }}
   */
  function resolveView() {
    if (state.viewMode === "instr") {
      const h =
        state.instrHistory.find(
          (x) => x.slot === state.pointSlot && x.histIndex === state.histIndex,
        ) || state.instrHistory[state.histIndex];
      const regs = h ? h.regs : state.current;
      return {
        regs,
        meta:
          `命令ブレイク:${h ? h.slot : state.pointSlot}  履歴:${state.histIndex}`,
        breakText: h
          ? `命令ブレイク slot ${h.slot}\n履歴 ${h.histIndex} / 最大 7\nIC=${regs.IC} で停止（モック）`
          : "命令ブレイク履歴なし",
      };
    }
    if (state.viewMode === "addr") {
      const h =
        state.addrHistory.find(
          (x) => x.slot === state.pointSlot && x.histIndex === state.histIndex,
        ) || state.addrHistory[state.histIndex];
      const regs = h ? h.regs : state.current;
      const meta = h
        ? `メモリブレイク:${h.slot}  履歴:${h.histIndex}\nブレイク条件 ${h.access} ${h.condition}\n${h.access}:${h.value}  前回WRITE:${h.prevWrite}`
        : `アドブレイク:${state.pointSlot}  履歴:${state.histIndex}`;
      const breakText = h
        ? `${h.kind}ブレイク slot ${h.slot}\n条件 ${h.access} ${h.condition}\nVALUE ${h.value}  PREV ${h.prevWrite}`
        : "アドレスブレイク履歴なし";
      return { regs, meta, breakText };
    }
    return {
      regs: state.current,
      meta: "現在値",
      breakText:
        "ブレイク未発生（モック）。\n命令ブレイクは逆アセンブラ、メモリブレイクはダンプ上で設定予定。",
    };
  }

  /**
   * レジスタタブを描画する。
   */
  function renderTabs() {
    const el = document.getElementById("regTabs");
    if (!el) return;
    const histBtns = [];
    for (let i = 0; i < 8; i += 1) {
      const active =
        state.viewMode !== "current" && state.histIndex === i ? " active" : "";
      histBtns.push(
        `<button type="button" data-hist="${i}" class="${active.trim()}">${i}</button>`,
      );
    }
    const curActive = state.viewMode === "current" ? " active" : "";
    const instrActive = state.viewMode === "instr" ? " active" : "";
    const addrActive = state.viewMode === "addr" ? " active" : "";
    el.innerHTML = `
      <div class="group">
        <button type="button" data-mode="current" class="${curActive.trim()}">現在</button>
      </div>
      <div class="sep"></div>
      <div class="group">${histBtns.join("")}</div>
      <div class="sep"></div>
      <div class="group">
        <button type="button" data-mode="instr" class="${instrActive.trim()}">命令 0-7</button>
        <button type="button" data-mode="addr" class="${addrActive.trim()}">アド 0-5</button>
      </div>
    `;
  }

  /**
   * レジスタ本体を描画する。
   * @param {Regs} regs
   * @param {string} meta
   */
  function renderRegs(regs, meta) {
    const metaEl = document.getElementById("regMeta");
    const body = document.getElementById("regBody");
    const stack = document.getElementById("stackDump");
    if (metaEl) metaEl.textContent = meta;
    if (body) {
      body.textContent =
        `時刻:${regs.time}\n` +
        `R0:${regs.R0}  R1:${regs.R1}  R2:${regs.R2}  R3:${regs.R3}  R4:${regs.R4}\n` +
        `IC:${regs.IC}  SP:${regs.SP}  STR:${regs.STR}\n` +
        `CSBR:${regs.CSBR} SSBR:${regs.SSBR} TSR0:${regs.TSR0} TSR1:${regs.TSR1}\n` +
        `NPP:${regs.NPP} IISR:${regs.IISR}`;
    }
    if (stack) {
      const pairs = [];
      for (let i = 0; i < regs.stack.length; i += 4) {
        pairs.push(
          `SP+${String(i + 1).padStart(2, " ")}: ` +
            regs.stack.slice(i, i + 4).join(" "),
        );
      }
      stack.textContent = pairs.join("\n");
    }
  }

  /** 逆アセンブルを描画する */
  function renderDisasm() {
    const el = document.getElementById("disasm");
    if (!el) return;
    el.innerHTML = state.disasm
      .map((line) => {
        const cls = ["line", "disasm"];
        if (line.current) cls.push("current");
        const g = line.bp ? "●" : "";
        return (
          `<div class="${cls.join(" ")}">` +
          `<span class="gutter${line.bp ? " bp" : ""}">${g}</span>` +
          `<span class="addr">${esc(line.addr)}</span>` +
          `<span class="bytes">${esc(line.bytes)}</span>` +
          `<span class="text">${esc(line.text)}</span>` +
          `</div>`
        );
      })
      .join("");
  }

  /** ソースを描画する */
  function renderSource() {
    const head = document.getElementById("sourceHead");
    const el = document.getElementById("source");
    if (head) head.textContent = `アセンブラソース — ${state.sourcePath}`;
    if (!el) return;
    el.innerHTML = state.sourceLines
      .map((text, i) => {
        const n = i + 1;
        const cls = ["line"];
        if (n === state.sourceFocusLine) cls.push("focus");
        return (
          `<div class="${cls.join(" ")}">` +
          `<span class="gutter">${n}</span>` +
          `<span class="addr"></span>` +
          `<span class="text">${esc(text)}</span>` +
          `</div>`
        );
      })
      .join("");
  }

  /** BP 一覧を描画する */
  function renderBp() {
    const instr = document.getElementById("bpInstr");
    const addr = document.getElementById("bpAddr");
    if (instr) {
      instr.innerHTML = state.bpInstr
        .map(
          (b) =>
            `<li class="${b.enabled ? "on" : ""}">` +
            `<span class="slot">${b.slot}</span>` +
            `<span>${esc(b.addr)}</span>` +
            `</li>`,
        )
        .join("");
    }
    if (addr) {
      addr.innerHTML = state.bpAddr
        .map(
          (b) =>
            `<li class="${b.enabled ? "on" : ""}">` +
            `<span class="slot">${b.slot}</span>` +
            `<span>${esc(b.kind)} ${esc(b.addr)} ${esc(b.access)}</span>` +
            `</li>`,
        )
        .join("");
    }
  }

  /**
   * ブレイク情報を描画する。
   * @param {string} text
   */
  function renderBreak(text) {
    const el = document.getElementById("breakInfo");
    if (el) el.textContent = text;
  }

  /** メモリダンプを描画する */
  function renderMem() {
    const el = document.getElementById("memDump");
    if (!el) return;
    el.innerHTML = state.memDump
      .map((row) => {
        const words = row.words
          .map((w) => `<span class="word" data-addr="${esc(row.addr)}">${esc(w)}</span>`)
          .join("");
        return (
          `<div class="line mem">` +
          `<span class="addr">${esc(row.addr)}</span>` +
          words +
          `</div>`
        );
      })
      .join("");
  }

  /** 全体を再描画する */
  function render() {
    const title = document.getElementById("title");
    if (title) title.textContent = state.title;
    renderTabs();
    const view = resolveView();
    renderRegs(view.regs, view.meta);
    renderDisasm();
    renderSource();
    renderBp();
    renderBreak(view.breakText);
    renderMem();
  }

  document.body.addEventListener("click", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const btn = t.closest("button");
    if (!btn) {
      if (t.classList.contains("word")) {
        vscode.postMessage({ type: "command", cmd: "memBreakDialog" });
      }
      return;
    }
    if (btn.dataset.cmd) {
      vscode.postMessage({ type: "command", cmd: btn.dataset.cmd });
      return;
    }
    if (btn.dataset.mode) {
      state.viewMode = btn.dataset.mode;
      if (state.viewMode === "instr") state.pointSlot = 1;
      if (state.viewMode === "addr") state.pointSlot = 0;
      render();
      return;
    }
    if (btn.dataset.hist !== undefined) {
      state.histIndex = Number(btn.dataset.hist);
      if (state.viewMode === "current") state.viewMode = "instr";
      render();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "state" && msg.state) {
      state = msg.state;
      render();
    }
  });

  render();
  vscode.postMessage({ type: "ready" });
})();
