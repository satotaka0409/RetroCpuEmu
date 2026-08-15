import type { DebugViewState } from "./mockState";

/**
 * デバッグ Webview の HTML を生成する。
 * @param nonce CSP 用 nonce
 * @param cspSource webview.cspSource
 * @param cssUri スタイル URI
 * @param jsUri スクリプト URI
 * @param state 初期表示状態
 * @returns HTML 文字列
 */
export function getDebugHtml(
  nonce: string,
  cspSource: string,
  cssUri: string,
  jsUri: string,
  state: DebugViewState,
): string {
  const stateJson = JSON.stringify(state).replace(/</g, "\\u003c");
  const noteEsc = String(state.memNote ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Retro CPU Debug</title>
</head>
<body>
  <header class="toolbar">
    <div class="toolbar-title" id="title">Retro CPU Debug</div>
    <div class="toolbar-actions">
      <button type="button" data-cmd="loadHex" title="Intel HEX / CDB を読み込む">読込</button>
      <button type="button" data-cmd="run" title="実行（未実装）">実行</button>
      <button type="button" data-cmd="halt" title="停止（未実装）">停止</button>
      <button type="button" data-cmd="step" title="ステップ（未実装）">Step</button>
      <span class="toolbar-note" id="memNote">${noteEsc}</span>
    </div>
  </header>

  <main class="layout">
    <aside class="pane-regs" aria-label="レジスタ表示">
      <div class="pane-head">レジスタ</div>
      <div class="reg-tabs" id="regTabs"></div>
      <div class="reg-meta" id="regMeta"></div>
      <div class="reg-body" id="regBody"></div>
      <div class="pane-head sub">スタック（16ワード）</div>
      <pre class="stack-dump" id="stackDump"></pre>
    </aside>

    <section class="pane-disasm" aria-label="逆アセンブラ">
      <div class="pane-head">逆アセンブラ</div>
      <div class="code-scroll" id="disasm"></div>
    </section>

    <section class="pane-source" aria-label="アセンブラソース">
      <div class="pane-head" id="sourceHead">アセンブラソース</div>
      <div class="code-scroll" id="source"></div>
    </section>

    <section class="pane-mem" aria-label="メモリダンプ">
      <div class="pane-head">メモリダンプ（±800h をハンドシェイク取得／端で再取得）</div>
      <div class="code-scroll mem" id="memDump"></div>
    </section>

    <section class="pane-break" aria-label="ブレイク情報">
      <div class="pane-head">ブレイク情報</div>
      <ul class="bp-list" id="bpSlots"></ul>
      <div class="break-body" id="breakInfo"></div>
    </section>
  </main>

  <div id="memMenu" class="ctx-menu" hidden>
    <button type="button" data-mem-cmd="goto">アドレス指定…</button>
  </div>
  <div id="memGoto" class="modal" hidden>
    <div class="modal-box">
      <div class="modal-title">表示アドレス</div>
      <p class="modal-hint">物理ワード（16進、最大5桁。例 01800 / 3F000）</p>
      <input id="memGotoInput" type="text" maxlength="5" spellcheck="false" autocomplete="off" />
      <div class="modal-actions">
        <button type="button" data-mem-cmd="gotoOk">表示</button>
        <button type="button" data-mem-cmd="gotoCancel">取消</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">window.__RETRO_DEBUG_STATE__ = ${stateJson};</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
