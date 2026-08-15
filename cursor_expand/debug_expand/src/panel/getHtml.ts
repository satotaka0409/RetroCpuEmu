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
      <span class="toolbar-note">HEX/CDB 読込可 — 実行接続は後続</span>
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

    <aside class="pane-bp" aria-label="ブレイクポイント一覧">
      <div class="pane-head">BP</div>
      <div class="bp-block">
        <div class="bp-label">命令 0–7</div>
        <ul class="bp-list" id="bpInstr"></ul>
      </div>
      <div class="bp-block">
        <div class="bp-label">アド 0–7</div>
        <ul class="bp-list" id="bpAddr"></ul>
      </div>
    </aside>

    <section class="pane-break" aria-label="ブレイク情報">
      <div class="pane-head">ブレイク情報</div>
      <div class="break-body" id="breakInfo"></div>
    </section>

    <section class="pane-mem" aria-label="メモリダンプ">
      <div class="pane-head">メモリダンプ</div>
      <div class="code-scroll mem" id="memDump"></div>
    </section>
  </main>

  <script nonce="${nonce}">window.__RETRO_DEBUG_STATE__ = ${stateJson};</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
