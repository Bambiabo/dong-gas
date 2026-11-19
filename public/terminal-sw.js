/* Dong Gas Option A v1: supervisor shell only. No shift data is stored here. */
const SHELL_CACHE = "dong-gas-supervisor-shell-option-a-v1";
const ASSET_CACHE = "dong-gas-supervisor-assets-option-a-v1";
const SHELL_PATH = "/supervisor";

function isSupervisor(url) {
  return url.origin === self.location.origin &&
    (url.pathname === "/supervisor" || url.pathname === "/supervisor/");
}

self.addEventListener("install", () => {
  // Do not force an already open terminal onto a different worker version.
});

self.addEventListener("activate", (event) => {
  // Never delete IndexedDB, localStorage or unrelated caches.
  event.waitUntil(self.clients.claim());
});

async function fetchChecked(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
      headers: accept ? { Accept: accept } : undefined,
    });
    if (!response.ok || response.redirected || response.type === "opaque") {
      throw new Error("Could not prepare offline file: " + new URL(url).pathname);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_TERMINAL_OFFLINE") return;
  const port = event.ports && event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (!event.source || !event.source.url || !isSupervisor(new URL(event.source.url))) {
        throw new Error("Offline preparation is available only from the supervisor page.");
      }
      const requested = new URL(event.data.path || "", self.location.origin);
      if (!isSupervisor(requested)) throw new Error("Unsupported offline page.");
      const supplied = Array.isArray(event.data.assets) ? event.data.assets : [];
      if (supplied.length > 300) throw new Error("Too many offline assets. Reload online and retry.");
      const assets = new Set();
      for (const item of supplied) {
        if (typeof item !== "string") throw new Error("Invalid offline asset.");
        const url = new URL(item, self.location.origin);
        if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) {
          throw new Error("Unsupported offline asset.");
        }
        assets.add(url.href);
      }
      if (!assets.size) throw new Error("No app assets found. Reload online and retry.");
      const shellUrl = new URL(SHELL_PATH, self.location.origin).href;
      const shell = await fetchChecked(shellUrl, "text/html");
      if (!(shell.headers.get("content-type") || "").includes("text/html")) {
        throw new Error("The supervisor page did not return HTML.");
      }
      // Include scripts/styles referenced by the freshly fetched shell as well.
      const html = await shell.clone().text();
      const pattern = /(?:src|href)=["']([^"']+)["']/g;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = new URL(match[1].replace(/&amp;/g, "&"), self.location.origin);
        if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
          assets.add(url.href);
        }
      }
      if (assets.size > 400) throw new Error("Offline asset limit exceeded.");
      const cache = await caches.open(ASSET_CACHE);
      const queue = [...assets];
      for (let offset = 0; offset < queue.length; offset += 6) {
        await Promise.all(queue.slice(offset, offset + 6).map(async (url) => {
          const existing = await cache.match(url);
          if (existing) return;
          const response = await fetchChecked(url);
          await cache.put(url, response);
        }));
      }
      // Replace the offline HTML only after its assets have been prepared.
      const pages = await caches.open(SHELL_CACHE);
      await pages.put(shellUrl, shell);
      port.postMessage({ ok: true });
    } catch (error) {
      port.postMessage({ ok: false, error: error instanceof Error ? error.message : "Offline preparation failed." });
    } finally {
      port.close();
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept owner pages, API requests, Supabase calls or uploads.
  if (request.mode === "navigate" && isSupervisor(url) && !url.search) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error("Supervisor page is unavailable.");
        return response;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const saved = await cache.match(new URL(SHELL_PATH, self.location.origin).href);
        if (saved) return saved;
        return new Response(
          "Offline reopening has not been prepared on this device. Reconnect without clearing browser storage.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }
        );
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
  }
});