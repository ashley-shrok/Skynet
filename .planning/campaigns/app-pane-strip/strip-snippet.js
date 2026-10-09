// App strip tasting — paste into DevTools console on the live Skynet tab.
// Idempotent: re-pasting removes the previous injection first.
// Remove entirely: __appStrip.remove()   Switch style: __appStrip.set('f'|'g'|'h'|'a') or use the picker bottom-right.
(() => {
  if (window.__appStrip) window.__appStrip.remove();

  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>',
  };
  const HEIGHT = { f: 42, g: 42, h: 40, a: 30 };
  const NAMES = { f: "Pill · neutral", g: "Pill · warm", h: "Glass bar", a: "Quiet bar (old)" };

  const css = document.createElement("style");
  css.id = "app-strip-tasting-css";
  css.textContent = `
  .ast { display:flex; align-items:center; flex:none; user-select:none; cursor:grab; position:relative;
         font-family: Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif; --hue: 210; }
  .ast button { all:unset; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;
         color:#a89a80; border-radius:6px; transition:color .12s, background .12s, opacity .12s; }
  .ast button:hover:not([disabled]) { color:#e8e4d8; background:rgba(232,228,216,0.08); }
  .ast button[disabled] { opacity:.28; cursor:default; }
  .ast svg { width:15px; height:15px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .ast .navs { display:flex; gap:2px; }
  .ast .ident { display:flex; align-items:center; gap:7px; min-width:0; }
  .ast .ic { flex:none; border-radius:5px; overflow:hidden; display:grid; place-items:center; color:#fff; font-weight:700;
         background:linear-gradient(150deg, hsl(var(--hue) 60% 55%), hsl(var(--hue) 55% 38%)); }
  .ast .ic img { width:100%; height:100%; object-fit:cover; }
  .ast .nm { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .ast-a { height:30px; padding:0 8px; gap:8px; background:#141520; border-bottom:1px solid rgba(220,225,245,0.1); }
  .ast-a button { width:24px; height:22px; } .ast-a .ic { width:16px; height:16px; font-size:9px; border-radius:4px; }
  .ast-a .nm { color:#a89a80; font-size:12px; }


  /* Pill variants: quiet bar, nav left, app name centered in a task-pill-style glass pill (the drag surface). */
  .ast-f, .ast-g { height:42px; padding:0 8px; gap:8px; background:#141520; border-bottom:1px solid rgba(220,225,245,0.1); cursor:default;
    display:grid; grid-template-columns:82px minmax(0,1fr) 82px; }
  .ast-f::after, .ast-g::after { content:""; }
  .ast-f button, .ast-g button { width:26px; height:24px; }
  .ast-f .ident, .ast-g .ident {
    justify-self:center; max-width:100%; min-width:0; box-sizing:border-box;
    border-radius:20px; padding:5px 14px 5px 8px; cursor:grab; color:#e8e4d8; font-size:13px; font-weight:500;
    backdrop-filter:blur(24px) saturate(1.4); -webkit-backdrop-filter:blur(24px) saturate(1.4);
    animation: pv-identity-breathe 5s ease-in-out infinite;
    transition: transform .15s;
  }
  .ast-f .ident:active, .ast-g .ident:active { cursor:grabbing; }
  .ast-f .ident {
    background:linear-gradient(160deg, hsla(230,14%,26%,.78), hsla(230,14%,15%,.86));
    border:1px solid hsla(230,30%,70%,.22);
    box-shadow:0 4px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,220,170,.12), 0 0 22px hsla(230,40%,60%,.12);
  }
  .ast-g .ident {
    background:linear-gradient(160deg, hsla(35,45%,25%,.72), hsla(35,40%,15%,.82));
    border:1px solid hsla(35,65%,55%,.4);
    box-shadow:0 4px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,220,170,.14), 0 0 24px hsla(35,65%,55%,.24);
  }
  .ast-f .ic, .ast-g .ic { width:18px; height:18px; font-size:10px; border-radius:5px; }

  /* Glass bar: the whole strip wears the task pill's glass, name centered. */
  .ast-h { height:40px; padding:0 8px; gap:8px;
    background:linear-gradient(160deg, hsla(230,14%,24%,.85), hsla(230,14%,14%,.92));
    border-bottom:1px solid hsla(230,30%,70%,.2);
    box-shadow:0 4px 12px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,220,170,.10); z-index:1; }
  .ast-h button { width:26px; height:24px; }
  .ast-h .ident { position:absolute; left:50%; transform:translateX(-50%); max-width:55%; pointer-events:none; }
  .ast-h .ic { width:18px; height:18px; font-size:10px; } .ast-h .nm { color:#e8e4d8; font-size:13px; font-weight:500; }

  #ast-picker { position:fixed; right:14px; bottom:14px; z-index:2147483000; display:flex; gap:4px; padding:5px;
         background:rgba(16,17,24,.92); border:1px solid rgba(220,225,245,0.12); border-radius:999px;
         font:12px Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.5); }
  #ast-picker button { all:unset; cursor:pointer; padding:4px 10px; border-radius:999px; color:#a89a80; }
  #ast-picker button[aria-pressed="true"] { color:#e8e4d8; background:rgba(232,228,216,0.1); }
  #ast-picker button.x { color:#7a6f60; }
  `;
  document.head.appendChild(css);

  let variant = "f";
  const injected = new Map(); // iframe -> { strip, restore[], timer, sync }

  const titleFor = (hostId, slug) => {
    const tile = document.querySelector(`[data-app-key="${hostId}:${slug}"] .pv-app-title`);
    if (tile) return tile.textContent;
    return slug.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  };

  const attach = (iframe) => {
    if (injected.has(iframe)) return;
    const parent = iframe.parentElement;
    if (!parent) return;
    const hostId = iframe.dataset.appHostid, slug = iframe.dataset.appSlug;
    const name = titleFor(hostId, slug);

    const strip = document.createElement("div");
    strip.className = `ast ast-${variant}`;
    strip.innerHTML = `
      <div class="navs">
        <button data-a="back" title="Back" aria-label="Back">${ICON.back}</button>
        <button data-a="fwd" title="Forward" aria-label="Forward">${ICON.fwd}</button>
        <button data-a="reload" title="Reload" aria-label="Reload">${ICON.reload}</button>
      </div>
      <div class="ident"><div class="ic">${name.charAt(0).toUpperCase()}</div><div class="nm"></div></div>`;
    strip.querySelector(".nm").textContent = name;
    const ic = strip.querySelector(".ic");
    const img = new Image();
    img.onload = () => { ic.textContent = ""; ic.style.background = "rgba(220,225,245,0.08)"; ic.appendChild(img); };
    img.src = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/icon`;

    // Floor: the frame's history position when the strip attached. Back never goes below it.
    let floor = null;
    const nav = () => { try { return iframe.contentWindow.navigation; } catch { return null; } };
    const [bBack, bFwd] = strip.querySelectorAll("[data-a=back],[data-a=fwd]");
    // Clear Skynet's floating sidebar toggle when the strip sits under it.
    const clearToggle = () => {
      const t = document.querySelector('button[aria-label="Toggle sidebar"]');
      strip.style.paddingLeft = "";
      if (!t) return;
      const tr = t.getBoundingClientRect(), sr = strip.getBoundingClientRect();
      if (tr.width && tr.left < sr.left + 40 && tr.right > sr.left && tr.top < sr.bottom && tr.bottom > sr.top) {
        strip.style.paddingLeft = `${Math.ceil(tr.right - sr.left) + 6}px`;
      }
    };
    const sync = () => {
      clearToggle();
      const n = nav();
      if (!n || !n.currentEntry) { bBack.disabled = true; bFwd.disabled = true; return; }
      if (floor === null) floor = n.currentEntry.index;
      bBack.disabled = !(n.canGoBack && n.currentEntry.index > floor);
      bFwd.disabled = !n.canGoForward;
    };
    strip.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b || b.disabled) return;
      const n = nav();
      try {
        if (b.dataset.a === "back" && n) n.back();
        if (b.dataset.a === "fwd" && n) n.forward();
        if (b.dataset.a === "reload") iframe.contentWindow.location.reload();
      } catch (err) { console.warn("[app-strip-tasting]", err); }
      setTimeout(sync, 300);
    });

    // Never touch the parent — Skynet toggles its display/visibility to show and hide tabs.
    // The strip sits in normal flow above the frame; the frame shrinks by the strip's height.
    const restore = [[iframe, "height", iframe.style.height], [iframe, "display", iframe.style.display]];
    iframe.style.display = "block";
    iframe.style.height = `calc(100% - ${HEIGHT[variant]}px)`;
    parent.insertBefore(strip, iframe);
    iframe.addEventListener("load", sync);
    const timer = setInterval(sync, 500);
    sync();
    injected.set(iframe, { strip, restore, timer, sync });
  };

  const detach = (iframe) => {
    const rec = injected.get(iframe);
    if (!rec) return;
    clearInterval(rec.timer);
    iframe.removeEventListener("load", rec.sync);
    rec.strip.remove();
    for (const [el, prop, val] of rec.restore) el.style[prop] = val;
    injected.delete(iframe);
  };

  const scan = () => {
    document.querySelectorAll("iframe[data-app-slug]").forEach(attach);
    for (const f of [...injected.keys()]) if (!f.isConnected) detach(f);
  };
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });

  const picker = document.createElement("div");
  picker.id = "ast-picker";
  picker.innerHTML = Object.entries(NAMES).map(([k, v]) =>
    `<button data-v="${k}" title="${v}" aria-pressed="${k === variant}">${k.toUpperCase()} · ${v}</button>`).join("")
    + `<button class="x" data-x title="Remove the tasting">✕</button>`;
  picker.addEventListener("click", (e) => {
    if (e.target.closest("[data-x]")) return window.__appStrip.remove();
    const b = e.target.closest("[data-v]");
    if (b) window.__appStrip.set(b.dataset.v);
  });
  document.body.appendChild(picker);

  window.__appStrip = {
    set(v) {
      if (!NAMES[v]) return;
      variant = v;
      for (const [f, { strip }] of injected) { strip.className = `ast ast-${v}`; f.style.height = `calc(100% - ${HEIGHT[v]}px)`; }
      picker.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
    },
    remove() {
      mo.disconnect();
      for (const f of [...injected.keys()]) detach(f);
      picker.remove(); css.remove();
      delete window.__appStrip;
    },
  };
  scan();
  console.log(`[app-strip-tasting] attached to ${injected.size} open app pane(s). Picker is bottom-right.`);
})();
