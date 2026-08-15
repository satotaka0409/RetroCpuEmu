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
   * コンテキストメニューを隠す。
   */
  function hideMemMenu() {
    const menu = document.getElementById("memMenu");
    if (menu) menu.hidden = true;
  }

  /**
   * アドレス入力ダイアログの開閉。
   * @param {boolean} open 開くなら true
   */
  function setGotoOpen(open) {
    const modal = document.getElementById("memGoto");
    const input = document.getElementById("memGotoInput");
    if (!modal) return;
    modal.hidden = !open;
    if (open && input) {
      const cur = state.memStart != null ? Number(state.memStart) : 0;
      input.value = (cur & 0x3ffff).toString(16).toUpperCase().padStart(5, "0");
      input.focus();
      input.select();
    }
  }

  /**
   * 入力した 16 進を物理ワードにして拡張へ送る。
   */
  function submitGoto() {
    const input = document.getElementById("memGotoInput");
    const raw = (input && input.value ? input.value : "").trim();
    if (!/^[0-9A-Fa-f]{1,5}$/.test(raw)) {
      return;
    }
    const addr = parseInt(raw, 16) & 0x3ffff;
    setGotoOpen(false);
    vscode.postMessage({ type: "command", cmd: "gotoMem", addr });
  }

  /**
   * 表示対象のレジスタを決める。
   * @returns {{ regs: Regs, meta: string, breakText: string }}
   */
  function resolveView() {
    if (state.viewMode === "hist") {
      const h =
        (state.slotHistory || []).find(
          (x) => x.slot === state.pointSlot && x.histIndex === state.histIndex,
        ) || (state.slotHistory || [])[state.histIndex];
      const regs = h ? h.regs : state.current;
      const slot = h ? h.slot : state.pointSlot;
      const kind = h ? h.kind : "INST";
      const meta = h
        ? `スロット:${slot}  ${kind}  履歴:${h.histIndex}\n` +
          (kind === "MEM"
            ? `条件 ${h.access} ${h.condition}\n${h.access}:${h.value}  前回WRITE:${h.prevWrite}`
            : `アクセス ${h.access}`)
        : `スロット:${state.pointSlot}  履歴:${state.histIndex}`;
      const breakText = h
        ? `${kind} スロット ${h.slot}\n履歴 ${h.histIndex}\nIC=${regs.IC}`
        : "このスロットの履歴なし";
      return { regs, meta, breakText };
    }
    return {
      regs: state.current,
      meta: "現在値",
      breakText:
        "ブレイク未発生（モック）。\n比較器 0–7 は命令／メモリ／IO。ステップは比較器を使わない。",
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
        state.viewMode === "hist" && state.histIndex === i ? " active" : "";
      histBtns.push(
        `<button type="button" data-hist="${i}" class="${active.trim()}">${i}</button>`,
      );
    }
    const slotBtns = [];
    for (let i = 0; i < 8; i += 1) {
      const active =
        state.viewMode === "hist" && state.pointSlot === i ? " active" : "";
      slotBtns.push(
        `<button type="button" data-slot="${i}" class="${active.trim()}">${i}</button>`,
      );
    }
    const curActive = state.viewMode === "current" ? " active" : "";
    el.innerHTML = `
      <div class="group">
        <button type="button" data-mode="current" class="${curActive.trim()}">現在</button>
      </div>
      <div class="sep"></div>
      <div class="group">
        <span class="tab-label">履歴</span>${histBtns.join("")}
      </div>
      <div class="sep"></div>
      <div class="group">
        <span class="tab-label">スロット</span>${slotBtns.join("")}
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

  /** BP 一覧を描画する（スロット 0–7） */
  function renderBp() {
    const list = document.getElementById("bpSlots");
    if (!list) return;
    const slots = state.bpSlots || [];
    list.innerHTML = slots
      .map(
        (b) =>
          `<li class="${b.enabled ? "on" : ""}">` +
          `<span class="slot">${b.slot}</span>` +
          `<span>${esc(b.kind)}</span>` +
          `<span class="addr">${esc(b.addr)}</span>` +
          `<span>${esc(b.access)}${b.history ? " H" : ""}</span>` +
          `</li>`,
      )
      .join("");
  }

  /**
   * ブレイク情報を描画する。
   * @param {string} text
   */
  function renderBreak(text) {
    const el = document.getElementById("breakInfo");
    if (el) el.textContent = text;
  }

  /** メモリダンプを描画する（アドレス 5 桁、データ 4 桁） */
  function renderMem(scrollToAddr) {
    const el = document.getElementById("memDump");
    if (!el) return;
    const keep = el.scrollTop;
    el.innerHTML = (state.memDump || [])
      .map((row) => {
        const words = row.words
          .map(
            (w) =>
              `<span class="word" data-row="${esc(row.addr)}">${esc(w)}</span>`,
          )
          .join("");
        return (
          `<div class="line mem" data-addr="${esc(row.addr)}">` +
          `<span class="addr phys">${esc(row.addr)}</span>` +
          words +
          `</div>`
        );
      })
      .join("");
    if (scrollToAddr != null) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollMemTo(el, Number(scrollToAddr));
          reportMemScroll();
        });
      });
    } else {
      el.scrollTop = keep;
    }
  }

  /**
   * 指定ワードを含む行（または直前の行）をダンプ先頭に出す。
   * @param {HTMLElement} el スクロール容器
   * @param {number} scrollToAddr 物理ワード
   */
  function scrollMemTo(el, scrollToAddr) {
    const target = Number(scrollToAddr) & 0x3ffff;
    const lines = el.querySelectorAll(".line.mem");
    let best = null;
    let bestAddr = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const node = /** @type {HTMLElement} */ (lines[i]);
      const a = parseInt(node.dataset.addr || "0", 16);
      if (!Number.isFinite(a)) continue;
      if (a <= target && a >= bestAddr) {
        bestAddr = a;
        best = node;
      }
    }
    if (!best && lines.length) {
      best = /** @type {HTMLElement} */ (lines[0]);
    }
    if (!best) return;
    const first = /** @type {HTMLElement | null} */ (el.firstElementChild);
    const base = first ? first.offsetTop : 0;
    el.scrollTop = Math.max(0, best.offsetTop - base);
  }

  /**
   * 可視行の先頭／末尾ワードを拡張へ送り、窓の再取得判定させる。
   */
  function reportMemScroll() {
    const el = document.getElementById("memDump");
    if (!el) return;
    const lines = el.querySelectorAll(".line.mem");
    if (!lines.length) return;
    const box = el.getBoundingClientRect();
    let first = null;
    let last = null;
    for (let i = 0; i < lines.length; i += 1) {
      const node = /** @type {HTMLElement} */ (lines[i]);
      const r = node.getBoundingClientRect();
      if (r.bottom <= box.top + 0.5) continue;
      if (r.top >= box.bottom - 0.5) break;
      const a = parseInt(node.dataset.addr || "0", 16);
      if (!Number.isFinite(a)) continue;
      if (first === null) first = a;
      last = a + 15;
    }
    if (first === null || last === null) return;
    vscode.postMessage({ type: "memScroll", firstAddr: first, lastAddr: last });
  }

  let memScrollTimer = 0;
  /**
   * スクロールをまとめて報告する。
   */
  function onMemScrollDebounced() {
    if (memScrollTimer) clearTimeout(memScrollTimer);
    memScrollTimer = setTimeout(() => {
      memScrollTimer = 0;
      reportMemScroll();
    }, 80);
  }

  /** 全体を再描画する */
  function render() {
    const title = document.getElementById("title");
    if (title) title.textContent = state.title;
    const note = document.getElementById("memNote");
    if (note && state.memNote) note.textContent = state.memNote;
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
    hideMemMenu();
    const btn = t.closest("button");
    if (!btn) {
      return;
    }
    if (btn.dataset.memCmd === "goto") {
      setGotoOpen(true);
      return;
    }
    if (btn.dataset.memCmd === "gotoOk") {
      submitGoto();
      return;
    }
    if (btn.dataset.memCmd === "gotoCancel") {
      setGotoOpen(false);
      return;
    }
    if (btn.dataset.cmd) {
      vscode.postMessage({ type: "command", cmd: btn.dataset.cmd });
      return;
    }
    if (btn.dataset.mode === "current") {
      state.viewMode = "current";
      render();
      return;
    }
    if (btn.dataset.slot !== undefined) {
      state.pointSlot = Number(btn.dataset.slot);
      state.viewMode = "hist";
      render();
      return;
    }
    if (btn.dataset.hist !== undefined) {
      state.histIndex = Number(btn.dataset.hist);
      state.viewMode = "hist";
      render();
    }
  });

  document.body.addEventListener("contextmenu", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const pane = t.closest(".pane-mem");
    if (!pane) return;
    ev.preventDefault();
    const menu = document.getElementById("memMenu");
    if (!menu) return;
    menu.hidden = false;
    const x = Math.min(ev.clientX, window.innerWidth - 160);
    const y = Math.min(ev.clientY, window.innerHeight - 48);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  });

  document.body.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      hideMemMenu();
      setGotoOpen(false);
    }
    const modal = document.getElementById("memGoto");
    if (modal && !modal.hidden && ev.key === "Enter") {
      ev.preventDefault();
      submitGoto();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "state" && msg.state) {
      state = msg.state;
      render();
      return;
    }
    if (msg && msg.type === "mem") {
      state.memDump = msg.memDump;
      state.memStart = msg.memStart;
      state.memCacheLo = msg.memCacheLo;
      state.memCacheHi = msg.memCacheHi;
      if (msg.memNote) state.memNote = msg.memNote;
      const note = document.getElementById("memNote");
      if (note && state.memNote) note.textContent = state.memNote;
      renderMem(msg.scrollToAddr);
    }
  });

  const memEl = document.getElementById("memDump");
  if (memEl) {
    memEl.addEventListener("scroll", onMemScrollDebounced);
  }

  render();
  vscode.postMessage({ type: "ready" });
})();
