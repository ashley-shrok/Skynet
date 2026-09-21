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
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      data: { roomId: roomId, agentMxid: payload.agentMxid },
      tag: roomId ? `room-${roomId}` : "skynet-push", // groups per-room; iOS stacks by tag
      // Do NOT use `renotify: false` — every message should fire a fresh buzz per D-09.
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  const targetUrl = roomId ? `/?openRoom=${encodeURIComponent(roomId)}` : "/";
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
  event.waitUntil((async () => {
    const oldOptions = event.oldSubscription ? event.oldSubscription.options : null;
    if (!oldOptions) return;
    const fresh = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: oldOptions.applicationServerKey,
    });
    await fetch("/push-subscriptions", {
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
  })());
});

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
