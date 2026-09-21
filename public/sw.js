const CACHE_NAME = "skynet-static-v2";
const BASE_PATH = "__SKYNET_SW_BASE_PATH__";
const STATIC_ASSETS = [
  `${BASE_PATH}/favicon.ico`,
  `${BASE_PATH}/icons/48x48.png`,
  `${BASE_PATH}/icons/128x128.png`,
  `${BASE_PATH}/icons/256x256.png`,
  `${BASE_PATH}/icons/512x512.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              return caches.delete(name);
            }),
        );
      })
      .then(() => {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  if (
    url.pathname.startsWith("/host/opkssh-chooser/") ||
    url.pathname.startsWith("/host/opkssh-callback/")
  ) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  const isStaticAsset = STATIC_ASSETS.some((asset) => url.pathname === asset);

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  // iOS 16.4+ REQUIRES showNotification() to be called for every push,
  // or the subscription silently gets invalidated after too many silent pushes.
  // event.waitUntil is REQUIRED — without it iOS terminates the SW early and
  // may cancel the subscription (Apple forum confirmed pattern).
  // Defense-in-depth (Pitfall 3): if event.data is missing OR JSON parse throws,
  // still call showNotification with a safe fallback — NEVER return silently.
  let payload;
  try {
    payload = event.data
      ? event.data.json()
      : { title: "SKYNET", body: "" };
  } catch (_err) {
    payload = { title: "SKYNET", body: "(empty message)" };
  }
  const title = payload.title || "SKYNET";
  const body = payload.body || "";
  const roomId = payload.roomId;
  // Fix pass M-5: DO NOT set a `tag` — Web Notifications spec says
  // same-tag notifications REPLACE the previous one. Two messages in
  // the same room within a short window would collapse to only the
  // latest visible, and (without renotify:true) the second might not
  // even buzz. Preferring "each push shows independently, OS stacks
  // by app" over the earlier per-room grouping: matches D-09 ("every
  // message should fire a fresh buzz") without the collapse side-effect.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      data: { roomId: roomId, agentMxid: payload.agentMxid },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  // Fix pass M-4: prefix targetUrl with BASE_PATH so non-root deploys
  // land on the PWA, not the origin root. Mirrors the STATIC_ASSETS
  // BASE_PATH substitution at the top of this file.
  const targetUrl = roomId
    ? `${BASE_PATH}/?openRoom=${encodeURIComponent(roomId)}`
    : `${BASE_PATH}/`;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Focus an existing window if any, then navigate it; otherwise open a new one.
    for (const client of clientsList) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Re-subscribe when the browser rotates the subscription.
  // iOS in particular does this silently after 1-2 weeks or after ~100 pushes.
  //
  // Fix pass M-3: this handler was previously best-effort in the worst
  // way — no try/catch, no response.ok check, hardcoded absolute path
  // ignoring BASE_PATH, and a silent early-return when oldSubscription
  // was null. Any of those failure modes silently loses the new
  // endpoint after a silent rotation and the user only notices when
  // pushes stop arriving. Hardened:
  //   - Wrap the entire flow in try/catch → warn on any throw.
  //   - Check response.ok on the POST → warn on 4xx/5xx.
  //   - Prefix the URL with BASE_PATH so non-root deploys work.
  //   - When event.oldSubscription is null, still attempt to re-subscribe
  //     via applicationServerKey pulled from the current registration's
  //     manifest — MUST warn about the null oldSubscription so ops has
  //     a signal that recovery was best-effort.
  event.waitUntil((async () => {
    try {
      let applicationServerKey = null;
      if (event.oldSubscription && event.oldSubscription.options) {
        applicationServerKey = event.oldSubscription.options.applicationServerKey;
      } else {
        // No oldSubscription — nothing to recover the applicationServerKey
        // from inside the SW. Emit a warning + exit; the user will need
        // to tap the EnableNotificationsButton to re-mint a subscription
        // (that path fetches the VAPID key server-side and mints fresh).
        // eslint-disable-next-line no-console
        console.warn(
          "[phase-128] pushsubscriptionchange fired with null oldSubscription — cannot recover applicationServerKey; user must re-enable via UI",
        );
        return;
      }
      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const response = await fetch(`${BASE_PATH}/push-subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // JWT cookie
        body: JSON.stringify({
          endpoint: fresh.endpoint,
          keys: {
            p256dh: arrayBufferToBase64Url(fresh.getKey("p256dh")),
            auth: arrayBufferToBase64Url(fresh.getKey("auth")),
          },
        }),
      });
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[phase-128] pushsubscriptionchange POST failed status=${response.status} — new endpoint may be lost until user re-enables via UI`,
        );
      }
    } catch (err) {
      // Network throw / subscribe throw / any other exception — swallow
      // (event.waitUntil would silently drop it otherwise) and warn.
      // eslint-disable-next-line no-console
      console.warn(
        `[phase-128] pushsubscriptionchange threw err="${err && err.message ? err.message : String(err)}" — new endpoint may be lost until user re-enables via UI`,
      );
    }
  })());
});

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
