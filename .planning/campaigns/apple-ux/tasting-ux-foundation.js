// apple-ux / shape-ux-foundation — look tasting. Paste into DevTools console
// on the live app; re-paste is safe. A switcher pill sits bottom-centre:
// A / Off (also Alt+1..2). Look A = the chosen direction; iterate here.
(() => {
  document.getElementById("cx-look-style")?.remove();
  document.getElementById("cx-look-switch")?.remove();
  window.removeEventListener("keydown", window.__cxLookKeys || (() => {}), true);

  const M = '[data-slot="modal-content"]';
  const SMALL_ONE = ['340px','400px','520px'].map((w) => `${M}[class*="sm:max-w-[${w}]"]`);
  const SMALL = SMALL_ONE.join(', ');
  const smallEach = (suffix) => SMALL_ONE.map((s) => s + suffix).join(', ');
  const FIELD = `${M} input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), ${M} select, ${M} textarea`;
  const BTN = `${M} [data-slot="modal-body"] [data-slot="button"], ${M} [data-slot="modal-foot"] [data-slot="button"], ${M} [data-slot="modal-foot"] button, ${M} [data-slot="modal-head"] [data-slot="button"]`;

  // Structure every look shares: bigger plain title, no rule under the head,
  // tabs as one centred segmented control, side list with rounded selection,
  // roomier fields and buttons.
  const common = `
${M}{border-radius:22px!important}
@media (max-width:639px){${M}{border-radius:0!important}}
${M} [data-slot="modal-head"]{padding:20px 24px 12px!important;box-shadow:none!important;border-bottom:0!important;align-items:center!important}
${M} [data-slot="dialog-title"]{font-size:21px!important;font-weight:700!important;letter-spacing:-0.025em!important}
${M} [data-slot="modal-head-meta"]{letter-spacing:0!important;text-transform:none!important;font-size:12.5px!important;font-weight:500!important}
${M} [data-slot="dialog-description"]{font-size:13px!important;max-width:60ch}
${M} [data-slot="modal-body"]{padding:14px 24px 18px!important;font-size:14px!important}
${M} [data-slot="modal-foot"]{padding:14px 24px 18px!important;box-shadow:none!important;border-top:0!important;gap:10px!important}
${M} [data-slot="modal-tabs"]{justify-content:center!important;padding:2px 24px 14px!important;background:transparent!important;border-bottom:0!important;gap:0!important}
${M} [data-slot="modal-tabs"] > button{border:0!important;margin:0!important;padding:6px 18px!important;font-size:13px!important;transition:background .15s,color .15s!important}
${M} [data-slot="modal-sidebar"]{border-right:0!important}
${M} [data-slot="modal-sidebar"] > div:first-child{padding:8px!important;gap:2px!important}
${M} [data-slot="modal-sidebar"] button{border-left:0!important;border-radius:10px!important;padding:8px 12px!important;font-size:13.5px!important}
${M} [data-slot="modal-split"][data-drill] [data-slot="modal-sidebar"] button{padding:13px 16px!important;font-size:16px!important}
/* phone: small modals (sm/md/lg sizes) become bottom sheets sized to their content */
@media (max-width:639px){
${SMALL}{top:auto!important;bottom:0!important;left:0!important;right:0!important;height:auto!important;max-height:92dvh!important;border-radius:20px 20px 0 0!important;padding-top:14px!important;padding-bottom:env(safe-area-inset-bottom)!important;animation:cxsheet .26s cubic-bezier(.2,.8,.2,1)!important;border-bottom:0!important}
${smallEach("::before")}{content:"";position:absolute;top:6px;left:50%;transform:translateX(-50%);width:36px;height:5px;border-radius:3px;background:rgba(255,255,255,.22)}
${smallEach(' [data-slot="modal-head"]')}{padding-top:10px!important}
}
@keyframes cxsheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
${FIELD}{border-radius:10px!important;min-height:36px;font-size:14px!important}
${BTN}{min-height:36px!important;padding:0 18px!important;border-radius:10px!important;font-size:14px!important;font-weight:600!important;box-shadow:none!important}
`;

  const looks = {
    // A — Ink. One flat near-black surface, hairline edge, colour only for what's chosen or primary.
    A: `
${M}{background:#111216!important;border:1px solid rgba(255,255,255,.08)!important;box-shadow:0 30px 90px rgba(0,0,0,.7)!important;color:#ece8df}
${M} [data-slot="dialog-title"]{color:#f5f1e8!important}
${M} [data-slot="modal-head-meta"],${M} [data-slot="dialog-description"]{color:rgba(236,232,223,.5)!important}
${M} [data-slot="modal-body"]{color:rgba(236,232,223,.86)!important}
${M} [data-slot="modal-tabs"] > button{background:#1d1f25!important;color:rgba(236,232,223,.6)!important;border-radius:0!important}
${M} [data-slot="modal-tabs"] > button:first-of-type{border-radius:10px 0 0 10px!important}
${M} [data-slot="modal-tabs"] > button:last-of-type{border-radius:0 10px 10px 0!important}
${M} [data-slot="modal-tabs"] > button[aria-pressed="true"]{background:#34373f!important;color:#fff!important}
${M} [data-slot="modal-sidebar"]{background:transparent!important}
${M} [data-slot="modal-sidebar"] button{color:rgba(236,232,223,.72)!important}
${M} [data-slot="modal-sidebar"] button:hover{background:rgba(255,255,255,.05)!important}
${M} [data-slot="modal-sidebar"] button[aria-pressed="true"]{background:hsl(var(--pv-id-hue),60%,48%)!important;color:#fff!important}
${FIELD}{background:#1d1f25!important;border:1px solid transparent!important;color:#f0ece4!important}
${FIELD}:focus{border-color:hsl(var(--pv-id-hue),65%,58%)!important;outline:none!important}
${BTN}{background:#262930!important;border:0!important;color:#f0ece4!important}
${M} [data-slot="modal-foot"] [data-variant="default"]{background:hsl(var(--pv-id-hue),60%,48%)!important;color:#fff!important}
${M} [data-slot="modal-foot"] [data-variant="destructive"]{background:#c4413a!important;color:#fff!important}
`,
  };

  const style = document.createElement("style");
  style.id = "cx-look-style";
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "cx-look-switch";
  bar.style.cssText =
    "position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:2147483647;pointer-events:auto;display:flex;gap:2px;padding:3px;border-radius:12px;background:rgba(20,20,24,.92);border:1px solid rgba(255,255,255,.15);font:600 12px Inter Variable,system-ui;box-shadow:0 6px 20px rgba(0,0,0,.5)";
  const names = ["A", "Off"];
  const btns = names.map((n) => {
    const b = document.createElement("button");
    b.textContent = n;
    b.style.cssText =
      "pointer-events:auto;cursor:pointer;border:0;border-radius:9px;padding:5px 11px;color:#eee;background:transparent";
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => { e.stopPropagation(); set(n); };
    bar.appendChild(b);
    return b;
  });
  function set(n) {
    style.textContent = n === "Off" ? "" : common + looks[n];
    btns.forEach((b) => (b.style.background = b.textContent === n ? "rgba(255,255,255,.18)" : "transparent"));
    console.log("[cx-look]", n);
  }
  window.__cxLookKeys = (e) => {
    if (e.altKey && /^Digit[1-2]$/.test(e.code)) { e.preventDefault(); set(names[+e.code.slice(5) - 1]); }
  };
  window.addEventListener("keydown", window.__cxLookKeys, true);
  document.body.appendChild(bar);
  // On a phone-width screen the pill sits top-right so it never covers a sheet's buttons.
  const place = () => { const narrow = innerWidth < 640; Object.assign(bar.style, narrow ? { top: "8px", bottom: "auto", left: "auto", right: "8px", transform: "none" } : { top: "auto", bottom: "12px", left: "50%", right: "auto", transform: "translateX(-50%)" }); };
  place(); window.addEventListener("resize", place);
  set("A");
})();
// ── Kit panel: every shared modal element in look A, rendered inside the live app.
(() => {
  document.getElementById("kx-style")?.remove();
  document.getElementById("kx-root")?.remove();
  document.getElementById("kx-open")?.remove();

  const css = `
.kx{--hue:220;--bg:#111216;--s1:#1a1c21;--s2:#22252b;--s3:#2c2f37;--hair:rgba(255,255,255,.08);--hair2:rgba(255,255,255,.13);
  --t1:#f3efe6;--t2:rgba(236,232,223,.66);--t3:rgba(236,232,223,.42);
  --acc:hsl(var(--hue),62%,52%);--acc-soft:hsla(var(--hue),62%,55%,.16);--acc-text:hsl(var(--hue),80%,74%);
  --danger:#e5554c;--danger-soft:rgba(229,85,76,.14);--ok:#3fb27f;--warn:#d9a03f;
  font-family:"Inter Variable",system-ui,sans-serif;color:var(--t1);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.kx *{box-sizing:border-box}
#kx-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);pointer-events:auto}
.kx-card{width:min(1080px,94vw);height:min(88vh,860px);background:var(--bg);border:1px solid var(--hair);border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.7);display:flex;flex-direction:column;overflow:hidden}
@media(max-width:639px){.kx-card{width:100vw;height:100dvh;border-radius:0}}
.kx-head{display:flex;align-items:center;gap:12px;padding:20px 24px 12px}
.kx-title{font-size:21px;font-weight:700;letter-spacing:-.025em;margin:0}
.kx-sub{font-size:13px;color:var(--t2);margin:2px 0 0}
.kx-grow{flex:1}
.kx-split{flex:1;min-height:0;display:flex}
.kx-nav{width:196px;flex-shrink:0;overflow:auto;padding:4px 8px 12px}
.kx-main{flex:1;min-width:0;overflow:auto;padding:4px 28px 40px}
@media(max-width:639px){.kx-split{flex-direction:column}.kx-nav{width:auto;display:flex;overflow-x:auto;padding:0 12px 8px;gap:4px}.kx-nav .kx-side-item{white-space:nowrap}.kx-main{padding:4px 16px 32px}}
.kx-section{padding-top:22px}
.kx-h{font-size:15px;font-weight:650;letter-spacing:-.01em;margin:0 0 4px}
.kx-note{font-size:12.5px;color:var(--t3);margin:0 0 12px}
.kx-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.kx-col{display:flex;flex-direction:column;gap:14px;max-width:440px}

/* buttons */
.kx-btn{appearance:none;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 18px;border-radius:10px;font:600 14px/1 inherit;font-family:inherit;color:var(--t1);background:var(--s3);transition:background .12s,filter .12s,transform .06s}
.kx-btn:hover{filter:brightness(1.12)} .kx-btn:active{transform:translateY(1px)}
.kx-btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.kx-btn.primary{background:var(--acc);color:#fff}
.kx-btn.danger{background:var(--danger);color:#fff}
.kx-btn.danger-quiet{background:var(--danger-soft);color:#ff8a82}
.kx-btn.plain{background:transparent;color:var(--acc-text);padding:0 8px}
.kx-btn.plain:hover{background:var(--acc-soft);filter:none}
.kx-btn.small{height:28px;padding:0 12px;font-size:13px;border-radius:8px}
.kx-btn[disabled]{opacity:.38;pointer-events:none}
.kx-icon{appearance:none;border:0;cursor:pointer;width:32px;height:32px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--t2)}
.kx-icon:hover{background:var(--s2);color:var(--t1)}
.kx-icon.filled{background:var(--s2)}
.kx-icon svg,.kx-btn svg{width:16px;height:16px}

/* fields */
.kx-field{display:flex;flex-direction:column;gap:6px}
.kx-label{font-size:13px;font-weight:550;color:var(--t2)}
.kx-help{font-size:12.5px;color:var(--t3)}
.kx-err{font-size:12.5px;color:#ff8a82}
.kx-input,.kx-select,.kx-textarea{width:100%;height:38px;padding:0 12px;border-radius:10px;border:1px solid transparent;background-color:var(--s2);color:var(--t1);font:400 14px inherit;font-family:inherit;outline:none;transition:border-color .12s,background-color .12s}
.kx-input::placeholder,.kx-textarea::placeholder{color:var(--t3)}
.kx-input:hover,.kx-select:hover,.kx-textarea:hover{background-color:var(--s3)}
.kx-input:focus,.kx-select:focus,.kx-textarea:focus{border-color:var(--acc);background-color:var(--s2)}
.kx-input.bad{border-color:var(--danger)}
.kx-textarea{height:auto;min-height:92px;padding:10px 12px;resize:vertical;line-height:1.5}
.kx-select{appearance:none;padding-right:34px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23b9b4aa' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.kx-select option{background:#1d1f25;color:var(--t1)}
.kx-search{position:relative}
.kx-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--t3)}
.kx-search .kx-input{padding-left:34px;border-radius:10px}

/* grouped list (settings rows) */
.kx-group{background:var(--s1);border-radius:14px;overflow:hidden;max-width:560px}
.kx-group-title{font-size:13px;font-weight:550;color:var(--t2);margin:0 0 8px 4px}
.kx-group-foot{font-size:12.5px;color:var(--t3);margin:8px 4px 0;max-width:560px}
.kx-grow-row{display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 14px;position:relative}
.kx-grow-row + .kx-grow-row::before{content:"";position:absolute;top:0;left:14px;right:0;height:1px;background:var(--hair)}
.kx-grow-row.click{cursor:pointer} .kx-grow-row.click:hover{background:rgba(255,255,255,.03)}
.kx-grow-row .lbl{flex:1;min-width:0}
.kx-grow-row .val{color:var(--t2);font-size:13.5px}
.kx-grow-row .chev{color:var(--t3);width:14px;height:14px}
.kx-grow-row .kx-select{width:auto;height:30px;background-color:transparent;padding-left:8px;color:var(--t2)}
.kx-grow-row .kx-select:hover{background-color:var(--s2)}
.kx-grow-row.danger .lbl{color:#ff8a82}

/* toggles */
.kx-switch{appearance:none;width:42px;height:25px;border-radius:999px;background:var(--s3);position:relative;cursor:pointer;transition:background .18s;flex-shrink:0;border:0}
.kx-switch::after{content:"";position:absolute;top:2.5px;left:2.5px;width:20px;height:20px;border-radius:50%;background:#f5f2ea;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .18s}
.kx-switch:checked{background:var(--acc)} .kx-switch:checked::after{transform:translateX(17px)}
.kx-check{appearance:none;width:18px;height:18px;border-radius:5px;background:var(--s3);cursor:pointer;display:inline-grid;place-content:center;flex-shrink:0;margin:0}
.kx-check:checked{background:var(--acc)}
.kx-check:checked::after{content:"";width:9px;height:5px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.kx-radio{appearance:none;width:18px;height:18px;border-radius:50%;background:var(--s3);cursor:pointer;display:inline-grid;place-content:center;flex-shrink:0;margin:0}
.kx-radio:checked{background:var(--acc)} .kx-radio:checked::after{content:"";width:7px;height:7px;border-radius:50%;background:#fff}
.kx-opt{display:flex;align-items:center;gap:10px;cursor:pointer}
.kx-range{appearance:none;width:220px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--acc) var(--p,50%),var(--s3) var(--p,50%));outline:none}
.kx-range::-webkit-slider-thumb{appearance:none;width:20px;height:20px;border-radius:50%;background:#f5f2ea;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer}
.kx-range::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#f5f2ea;border:0}

/* segmented */
.kx-seg{display:inline-flex;padding:3px;border-radius:11px;background:var(--s2);gap:2px;max-width:100%;overflow-x:auto}
.kx-seg button{appearance:none;border:0;background:transparent;color:var(--t2);font:550 13px inherit;font-family:inherit;padding:6px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.kx-seg button:hover{color:var(--t1)}
.kx-seg button[aria-pressed=true]{background:var(--s3);color:var(--t1);box-shadow:0 1px 3px rgba(0,0,0,.35)}

/* chips */
.kx-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:550;background:var(--s2);color:var(--t2)}
.kx-chip.acc{background:var(--acc-soft);color:var(--acc-text)}
.kx-chip.ok{background:rgba(63,178,127,.14);color:#6fd3a5}
.kx-chip.warn{background:rgba(217,160,63,.14);color:#e8bf72}
.kx-chip.bad{background:var(--danger-soft);color:#ff8a82}
.kx-chip .dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.kx-pick{appearance:none;border:1px solid var(--hair2);background:transparent;color:var(--t2);height:32px;padding:0 13px;border-radius:999px;font:550 13px inherit;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.kx-pick:hover{background:var(--s2);color:var(--t1)}
.kx-pick[aria-pressed=true]{background:var(--acc);border-color:transparent;color:#fff}
.kx-pick.round{width:34px;padding:0;justify-content:center}

/* list rows */
.kx-list{max-width:620px;display:flex;flex-direction:column;gap:2px}
.kx-item{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;cursor:pointer}
.kx-item:hover{background:var(--s1)}
.kx-item[aria-selected=true]{background:var(--acc-soft)}
.kx-item .av{width:38px;height:38px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;font-weight:700;font-size:15px;color:#fff}
.kx-item .txt{flex:1;min-width:0}
.kx-item .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kx-item .s{font-size:12.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kx-item.dim .av{filter:grayscale(1) brightness(.7)} .kx-item.dim .t{color:var(--t2)}
.kx-item .kx-icon{opacity:0} .kx-item:hover .kx-icon,.kx-item .kx-icon:focus{opacity:1}
@media(hover:none){.kx-item .kx-icon{opacity:1}}
.kx-status{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* side list */
.kx-side-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:9px;color:var(--t2);font-size:13.5px;font-weight:500;cursor:pointer}
.kx-side-item:hover{background:rgba(255,255,255,.05);color:var(--t1)}
.kx-side-item[aria-current=true]{background:var(--acc);color:#fff}
.kx-side-item svg{width:15px;height:15px;opacity:.85}
.kx-side-head{font-size:11.5px;font-weight:600;color:var(--t3);padding:14px 10px 4px}
.kx-side-demo{width:200px;background:transparent;padding:4px;border-radius:12px;border:1px dashed var(--hair)}

/* states */
.kx-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:28px 16px;max-width:420px;border:1px dashed var(--hair);border-radius:14px}
.kx-empty > svg{width:28px;height:28px;color:var(--t3);margin-bottom:4px}
.kx-empty .t{font-weight:600;font-size:15px}
.kx-empty .s{font-size:13px;color:var(--t3);margin-bottom:8px}
.kx-skel{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--s1),var(--s2),var(--s1));background-size:200% 100%;animation:kxsh 1.4s infinite}
@keyframes kxsh{to{background-position:-200% 0}}
.kx-spin{width:16px;height:16px;border-radius:50%;border:2px solid var(--s3);border-top-color:var(--t1);animation:kxsp .8s linear infinite}
@keyframes kxsp{to{transform:rotate(360deg)}}
.kx-banner{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:12px;font-size:13.5px;max-width:560px}
.kx-banner svg{width:16px;height:16px;flex-shrink:0;margin-top:1px}
.kx-banner.bad{background:var(--danger-soft);color:#ffb1ab}
.kx-banner.info{background:var(--s1);color:var(--t2)}
.kx-banner.warn{background:rgba(217,160,63,.12);color:#ecc985}
.kx-banner .x{margin-left:auto}

/* toolbar */
.kx-toolbar{display:flex;align-items:center;gap:4px;padding:6px;border-radius:12px;background:var(--s1);max-width:620px}
.kx-toolbar .kx-btn{height:30px;padding:0 10px;font-size:13px;background:transparent;color:var(--t2);font-weight:550}
.kx-toolbar .kx-btn:hover{background:var(--s2);color:var(--t1);filter:none}
.kx-crumbs{display:flex;align-items:center;gap:4px;font-size:13.5px;color:var(--t3);padding:0 6px}
.kx-crumbs b{color:var(--t1);font-weight:600}

/* menu */
.kx-menu{width:220px;background:#202228;border:1px solid var(--hair2);border-radius:12px;padding:5px;box-shadow:0 12px 32px rgba(0,0,0,.55)}
.kx-mi{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;font-size:13.5px;cursor:pointer}
.kx-mi:hover{background:var(--acc);color:#fff}
.kx-mi svg{width:15px;height:15px;opacity:.8}
.kx-mi.danger{color:#ff8a82} .kx-mi.danger:hover{background:var(--danger);color:#fff}
.kx-msep{height:1px;background:var(--hair);margin:5px 4px}

/* confirm sheet */
.kx-sheet-bg{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.kx-sheet{width:min(340px,92vw);background:#1a1c21;border:1px solid var(--hair2);border-radius:18px;padding:22px 20px 16px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.7);animation:kxpop .16s ease-out}
@keyframes kxpop{from{transform:scale(.96);opacity:0}}
.kx-sheet .t{font-weight:700;font-size:16px;margin-bottom:6px}
.kx-sheet .s{font-size:13.5px;color:var(--t2);margin-bottom:18px}
.kx-sheet .acts{display:flex;gap:8px}.kx-sheet .acts .kx-btn{flex:1}
.kx-sheet .kx-input{margin-bottom:16px;text-align:left}
@media(max-width:639px){.kx-sheet-bg{align-items:flex-end}.kx-sheet{width:100%;border-radius:20px 20px 0 0;border-bottom:0;padding:26px 18px calc(16px + env(safe-area-inset-bottom));position:relative;animation:kxup .26s cubic-bezier(.2,.8,.2,1)}.kx-sheet::before{content:"";position:absolute;top:7px;left:50%;transform:translateX(-50%);width:36px;height:5px;border-radius:3px;background:rgba(255,255,255,.22)}.kx-sheet .acts{flex-direction:column-reverse}.kx-sheet .acts .kx-btn{flex:none;height:44px;font-size:15px}}
@keyframes kxup{from{transform:translateY(100%)}}
`;

  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/></svg>',
  };

  const sections = [
    ["buttons", "Buttons", `
      <p class="kx-note">Main action, ordinary action, plain text action, destructive (loud and quiet), small size, unavailable, icon-only.</p>
      <div class="kx-row"><button class="kx-btn primary">Save</button><button class="kx-btn">Cancel</button><button class="kx-btn plain">${I.plus} New skill</button><button class="kx-btn danger">Delete</button><button class="kx-btn danger-quiet">${I.trash} Remove</button></div>
      <div class="kx-row"><button class="kx-btn primary small">Add</button><button class="kx-btn small">${I.upload} Upload</button><button class="kx-btn primary" disabled>Save</button><button class="kx-btn primary"><span class="kx-spin" style="border-color:rgba(255,255,255,.3);border-top-color:#fff"></span> Saving…</button></div>
      <div class="kx-row"><button class="kx-icon" title="Close">${I.x}</button><button class="kx-icon" title="More">${I.dots}</button><button class="kx-icon" title="Edit">${I.pencil}</button><button class="kx-icon" title="Refresh">${I.refresh}</button><button class="kx-icon filled" title="Close">${I.x}</button></div>`],
    ["fields", "Fields", `
      <p class="kx-note">Label above, help below. Filled, no outline until focused. Every text field, dropdown and multi-line box shares one shape.</p>
      <div class="kx-col">
        <div class="kx-field"><label class="kx-label">Name</label><input class="kx-input" placeholder="Daily briefing"></div>
        <div class="kx-field"><label class="kx-label">Host</label><select class="kx-select"><option>Skynet</option><option>thenasty</option><option>workstation</option></select></div>
        <div class="kx-field"><label class="kx-label">Instructions</label><textarea class="kx-textarea" placeholder="What should the agent handling this task do?"></textarea><span class="kx-help">The agent sees this as its first message.</span></div>
        <div class="kx-field"><label class="kx-label">Slug</label><input class="kx-input bad" value="Daily Briefing!"><span class="kx-err">Lowercase letters, numbers and dashes only.</span></div>
        <div class="kx-search">${I.search}<input class="kx-input" placeholder="Search"></div>
      </div>`],
    ["settings", "Settings rows", `
      <p class="kx-note">Grouped rows: what it is on the left, its control on the right. For any modal that is mostly settings.</p>
      <p class="kx-group-title">Voice</p>
      <div class="kx-group">
        <div class="kx-grow-row"><span class="lbl">Read replies aloud</span><input type="checkbox" class="kx-switch" checked></div>
        <div class="kx-grow-row"><span class="lbl">Voice</span><select class="kx-select"><option>Aria</option><option>Sol</option></select></div>
        <div class="kx-grow-row"><span class="lbl">Speed</span><input type="range" class="kx-range" style="width:150px" min="25" max="400" value="100"><span class="val" style="width:40px;text-align:right">1×</span></div>
        <div class="kx-grow-row click"><span class="lbl">Send phrase</span><span class="val">"send it"</span>${I.chev}</div>
      </div>
      <p class="kx-group-foot">Voice mode sends after three seconds of silence unless you choose a send phrase.</p>
      <div style="height:18px"></div>
      <div class="kx-group">
        <div class="kx-grow-row click danger"><span class="lbl">Disconnect Telegram</span></div>
      </div>`],
    ["choices", "Toggles & choices", `
      <p class="kx-note">Switch for on/off, checkbox for ticking items in a list, round choice for one-of-a-few, slider for a range.</p>
      <div class="kx-col">
        <label class="kx-opt"><input type="checkbox" class="kx-switch" checked> Enabled</label>
        <label class="kx-opt"><input type="checkbox" class="kx-check" checked> Only show who messaged</label>
        <label class="kx-opt"><input type="checkbox" class="kx-check"> Run on weekends too</label>
        <label class="kx-opt"><input type="radio" name="kxr" class="kx-radio" checked> After a pause</label>
        <label class="kx-opt"><input type="radio" name="kxr" class="kx-radio"> When I say a phrase</label>
        <input type="range" class="kx-range" min="0" max="100" value="40">
      </div>`],
    ["segmented", "Segmented control", `
      <p class="kx-note">One choice among a few, all visible. Same control for a modal's tabs and for in-form choices like schedule type.</p>
      <div class="kx-row"><div class="kx-seg kx-seg-live"><button aria-pressed="true">Agent file</button><button>Wake-ups</button><button>Files</button><button>Git</button></div></div>
      <div class="kx-row"><div class="kx-seg kx-seg-live"><button aria-pressed="true">Daily</button><button>Weekly</button><button>Monthly</button><button>Yearly</button><button>Interval</button><button>One-shot</button></div></div>
      <div class="kx-row"><div class="kx-seg kx-seg-live"><button aria-pressed="true">Formatted</button><button>Plain text</button></div></div>`],
    ["chips", "Chips", `
      <p class="kx-note">Status labels (not clickable) and pick-chips (click to toggle — hosts, weekdays).</p>
      <div class="kx-row"><span class="kx-chip ok"><span class="dot"></span>Healthy</span><span class="kx-chip acc">instance-wide</span><span class="kx-chip">user only</span><span class="kx-chip">distributed</span><span class="kx-chip warn">Running long</span><span class="kx-chip bad">Broken</span><span class="kx-chip">archived</span></div>
      <div class="kx-row kx-pick-live"><button class="kx-pick" aria-pressed="true">Skynet</button><button class="kx-pick">thenasty</button><button class="kx-pick" aria-pressed="true">workstation</button><button class="kx-pick">ashley-laptop</button><button class="kx-pick">aither-cloud2-prod</button></div>
      <div class="kx-row kx-pick-live"><button class="kx-pick round" aria-pressed="true">M</button><button class="kx-pick round" aria-pressed="true">T</button><button class="kx-pick round" aria-pressed="true">W</button><button class="kx-pick round" aria-pressed="true">T</button><button class="kx-pick round" aria-pressed="true">F</button><button class="kx-pick round">S</button><button class="kx-pick round">S</button></div>`],
    ["rows", "List rows", `
      <p class="kx-note">One row for roles, scheduled tasks, search results, archived things, users. Three-dot menu appears on hover (always on touch).</p>
      <div class="kx-list kx-sel-live">
        <div class="kx-item"><div class="av" style="background:hsl(324,55%,45%)">S</div><div class="txt"><div class="t">box-maintainer</div><div class="s">Maintainer of the Skynet app and t1000</div></div><span class="kx-chip acc">instance-wide</span><button class="kx-icon">${I.dots}</button></div>
        <div class="kx-item" aria-selected="true"><div class="av" style="background:hsl(150,45%,38%)">G</div><div class="txt"><div class="t">garden-keeper</div><div class="s">Keeps the plant log and watering schedule</div></div><button class="kx-icon">${I.dots}</button></div>
        <div class="kx-item"><div class="av" style="background:hsl(32,60%,45%)">⏰</div><div class="txt"><div class="t">Morning triage</div><div class="s">Every 2h · Last 3h ago · Next in 27m</div></div><input type="checkbox" class="kx-switch" checked><button class="kx-icon">${I.dots}</button></div>
        <div class="kx-item dim"><div class="av" style="background:hsl(260,45%,45%)">P</div><div class="txt"><div class="t">platinum-box-maintainer</div><div class="s">Archived 3 days ago</div></div><span class="kx-chip">archived</span><button class="kx-icon">${I.dots}</button></div>
      </div>`],
    ["picker", "Host picker", `
      <p class="kx-note">Search plus pickable rows with a status dot — one picker for new role, new project, new session.</p>
      <div style="max-width:420px">
        <div class="kx-search" style="margin-bottom:8px">${I.search}<input class="kx-input" placeholder="Search hosts"></div>
        <div class="kx-group kx-host-live">
          <div class="kx-grow-row click"><span class="kx-status" style="background:var(--ok)"></span><span class="lbl">Skynet</span><span class="val">t1000</span><span class="hk" style="color:var(--acc-text);font-weight:700">✓</span></div>
          <div class="kx-grow-row click"><span class="kx-status" style="background:var(--ok)"></span><span class="lbl">thenasty</span><span class="val"></span><span class="hk"></span></div>
          <div class="kx-grow-row click"><span class="kx-status" style="background:var(--warn)"></span><span class="lbl">workstation</span><span class="val">slow</span><span class="hk"></span></div>
          <div class="kx-grow-row" style="opacity:.45"><span class="kx-status" style="background:#666"></span><span class="lbl">ashley-beelink</span><span class="val">offline</span><span class="hk"></span></div>
        </div>
      </div>`],
    ["side", "Side list", `
      <p class="kx-note">The list down the left of Preferences, Skills, Admin, runbooks. Optional group headings. On a phone it becomes a tap-through list.</p>
      <div class="kx-side-demo kx-side-live">
        <div class="kx-side-item" aria-current="true">${I.user} General</div>
        <div class="kx-side-item">${I.speaker} Voice</div>
        <div class="kx-side-item">${I.bell} Notifications</div>
        <div class="kx-side-head">Files</div>
        <div class="kx-side-item">${I.file} SKILL.md</div>
        <div class="kx-side-item">${I.file} reference.md</div>
      </div>`],
    ["menus", "Menus", `
      <p class="kx-note">The three-dot menu.</p>
      <div class="kx-menu"><div class="kx-mi">${I.pencil} Rename…</div><div class="kx-mi">${I.upload} Download</div><div class="kx-mi">${I.folder} Show in folder</div><div class="kx-msep"></div><div class="kx-mi danger">${I.trash} Delete</div></div>`],
    ["toolbar", "Toolbar", `
      <p class="kx-note">Where-you-are on the left, actions on the right — Files, Git, Desktop tabs.</p>
      <div class="kx-toolbar"><div class="kx-crumbs">workspace <span>/</span> <b>reports</b></div><span class="kx-grow"></span><button class="kx-btn">${I.upload} Upload</button><button class="kx-btn">${I.folder} New folder</button><button class="kx-btn">${I.file} New file</button><button class="kx-icon" title="Refresh">${I.refresh}</button></div>`],
    ["states", "Empty, loading, errors", `
      <p class="kx-note">One empty state, one loading look, one way to show a problem.</p>
      <div class="kx-row" style="align-items:flex-start"><div class="kx-empty">${I.inbox}<div class="t">No scheduled wake-ups</div><div class="s">Wake-ups send this agent an instruction at a time you choose.</div><button class="kx-btn primary small">${I.plus} Add wake-up</button></div>
      <div style="width:260px;display:flex;flex-direction:column;gap:10px;padding:14px"><div class="kx-skel" style="width:70%"></div><div class="kx-skel"></div><div class="kx-skel" style="width:85%"></div><div class="kx-row" style="margin-top:8px;color:var(--t3);font-size:13px"><span class="kx-spin"></span> Loading skills…</div></div></div>
      <div class="kx-col" style="max-width:560px">
        <div class="kx-banner bad">${I.alert}<span>Couldn't save — thenasty didn't answer. Your changes are still here; try again.</span><button class="kx-icon x" style="width:24px;height:24px">${I.x}</button></div>
        <div class="kx-banner warn">${I.alert}<span>This skill is shared to every host, so it's view-only here.</span></div>
        <div class="kx-banner info">${I.info}<span>Anything you drop in here, the agent can read; anything it saves, you can grab.</span></div>
      </div>`],
    ["dialogs", "Confirm & name dialogs", `
      <p class="kx-note">Replace the browser's grey pop-ups. Click to try.</p>
      <div class="kx-row"><button class="kx-btn danger-quiet" data-kx-confirm>${I.trash} Delete skill…</button><button class="kx-btn" data-kx-prompt>${I.plus} New file…</button><button class="kx-btn" data-kx-alert>Show a notice</button></div>`],
  ];

  const style = document.createElement("style");
  style.id = "kx-style";
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "kx-root";
  root.className = "kx";
  root.style.display = "none";
  root.innerHTML = `
    <div class="kx-card" role="dialog" aria-label="Kit">
      <div class="kx-head">
        <div><h2 class="kx-title">Kit</h2><p class="kx-sub">Every shared modal element, look A. Tint:</p></div>
        <div class="kx-seg kx-hue" style="margin-left:4px"><button aria-pressed="true" data-h="220">Slate</button><button data-h="324">Role pink</button><button data-h="150">Green</button><button data-h="32">Amber</button></div>
        <span class="kx-grow"></span>
        <button class="kx-icon filled" data-kx-close title="Close">${I.x}</button>
      </div>
      <div class="kx-split">
        <nav class="kx-nav">${sections.map(([id, t], i) => `<div class="kx-side-item" data-go="${id}" ${i ? "" : 'aria-current="true"'}>${t}</div>`).join("")}</nav>
        <div class="kx-main">${sections.map(([id, t, body]) => `<section class="kx-section" id="kx-s-${id}"><h3 class="kx-h">${t}</h3>${body}</section>`).join("")}</div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  root.addEventListener("pointerdown", (e) => e.stopPropagation(), true);
  $("[data-kx-close]").onclick = () => (root.style.display = "none");
  $$(".kx-nav .kx-side-item").forEach((n) => (n.onclick = () => {
    $$(".kx-nav .kx-side-item").forEach((m) => m.removeAttribute("aria-current"));
    n.setAttribute("aria-current", "true");
    $("#kx-s-" + n.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  const main = $(".kx-main");
  main.addEventListener("scroll", () => {
    const top = main.getBoundingClientRect().top + 40;
    let cur = sections[0][0];
    for (const [id] of sections) if ($("#kx-s-" + id).getBoundingClientRect().top <= top) cur = id;
    $$(".kx-nav .kx-side-item").forEach((m) => (m.dataset.go === cur ? m.setAttribute("aria-current", "true") : m.removeAttribute("aria-current")));
  });
  $$(".kx-seg-live, .kx-hue").forEach((g) => $$("button", g).forEach((b) => (b.onclick = () => {
    $$("button", g).forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    if (b.dataset.h) root.style.setProperty("--hue", b.dataset.h);
  })));
  $$(".kx-pick-live .kx-pick").forEach((b) => (b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true")));
  $$(".kx-side-live .kx-side-item").forEach((n) => (n.onclick = () => { $$(".kx-side-live .kx-side-item").forEach((m) => m.removeAttribute("aria-current")); n.setAttribute("aria-current", "true"); }));
  $$(".kx-sel-live .kx-item").forEach((n) => (n.onclick = (e) => { if (e.target.closest("button,input")) return; $$(".kx-sel-live .kx-item").forEach((m) => m.removeAttribute("aria-selected")); n.setAttribute("aria-selected", "true"); }));
  $$(".kx-host-live .click").forEach((n) => (n.onclick = () => { $$(".kx-host-live .hk").forEach((h) => (h.textContent = "")); $(".hk", n).textContent = "✓"; }));
  $$(".kx-range").forEach((r) => { const f = () => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"); r.oninput = f; f(); });

  function sheet(html, onReady) {
    const bg = document.createElement("div");
    bg.className = "kx-sheet-bg";
    bg.innerHTML = `<div class="kx-sheet">${html}</div>`;
    root.appendChild(bg);
    const close = () => bg.remove();
    $$("[data-x]", bg).forEach((b) => (b.onclick = close));
    onReady?.(bg, close);
  }
  $("[data-kx-confirm]").onclick = () => sheet(`<div class="t">Delete "daily-standup"?</div><div class="s">This removes the skill from Skynet for every agent. You can't undo this.</div><div class="acts"><button class="kx-btn" data-x>Cancel</button><button class="kx-btn danger" data-x>Delete</button></div>`);
  $("[data-kx-prompt]").onclick = () => sheet(`<div class="t">New file</div><div class="s">Name the file. It's created inside this skill.</div><input class="kx-input" placeholder="reference.md"><div class="acts"><button class="kx-btn" data-x>Cancel</button><button class="kx-btn primary" data-x>Create</button></div>`, (bg) => $(".kx-input", bg).focus());
  $("[data-kx-alert]").onclick = () => sheet(`<div class="t">Couldn't archive</div><div class="s">Un-archive the role "garden-keeper" first.</div><div class="acts"><button class="kx-btn primary" data-x>OK</button></div>`);

  const open = () => (root.style.display = "flex");
  const bar = document.getElementById("cx-look-switch");
  if (bar) {
    const b = document.createElement("button");
    b.id = "kx-open";
    b.textContent = "Kit";
    b.style.cssText = "pointer-events:auto;cursor:pointer;border:0;border-radius:9px;padding:5px 11px;color:#eee;background:transparent;border-left:1px solid rgba(255,255,255,.15);margin-left:2px";
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => { e.stopPropagation(); open(); };
    bar.appendChild(b);
  }
  window.__kxOpen = open;
})();
