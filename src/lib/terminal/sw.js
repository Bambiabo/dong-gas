const CACHE_NAME = "dong-gas-terminal-shell-v1";
const CACHE_PREFIX = "dong-gas-terminal-shell-";
const SHELL_PATHS_KEY = "/__dong_gas_terminal_shell_paths__";

self.addEventListener("install", () => {
  // Activate normally rather than forcing an update into an active shift.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== CACHE_NAME
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

async function getShellPaths(cache) {
  const response = await cache.match(SHELL_PATHS_KEY);

  if (!response) return [];

  try {
    return await response.json();
  } catch {
    return [];
  }
}

async function prepareOffline(message) {
  const shellUrl = new URL(message.path, self.location.origin);

  if (shellUrl.origin !== self.location.origin) {
    throw new Error("Invalid terminal address.");
  }

  shellUrl.search = "";
  shellUrl.hash = "";

  const cache = await caches.open(CACHE_NAME);

  // Omit credentials so authenticated server-rendered responses are not
  // intentionally stored as the public app shell.
  const response = await fetch(shellUrl.href, {
    credentials: "omit",
    cache: "reload",
    headers: {
      Accept: "text/html",
    },
  });

  const finalUrl = new URL(response.url);

  if (
    !response.ok ||
    response.redirected ||
    finalUrl.pathname !== shellUrl.pathname ||
    !(response.headers.get("content-type") || "").includes("text/html")
  ) {
    throw new Error(
      "The public terminal shell could not be cached. Authentication or a redirect may be blocking it."
    );
  }

  await cache.put(shellUrl.href, response);

  const assets = Array.isArray(message.assets)
    ? message.assets
    : [];

  for (const asset of [...new Set(assets)]) {
    const url = new URL(asset, self.location.origin);

    if (
      url.origin !== self.location.origin ||
      !url.pathname.startsWith("/_next/static/")
    ) {
      continue;
    }

    const assetResponse = await fetch(url.href, {
      credentials: "omit",
      cache: "reload",
    });

    if (!assetResponse.ok) {
      throw new Error("Some app files could not be cached.");
    }

    await cache.put(url.href, assetResponse);
  }

  const paths = await getShellPaths(cache);

  if (!paths.includes(shellUrl.pathname)) {
    paths.push(shellUrl.pathname);
  }

  await cache.put(
    SHELL_PATHS_KEY,
    new Response(JSON.stringify(paths), {
      headers: {
        "Content-Type": "application/json",
      },
    })
  );
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_TERMINAL_OFFLINE") return;

  const port = event.ports[0];

  event.waitUntil(
    prepareOffline(event.data)
      .then(() => {
        port?.postMessage({ ok: true });
      })
      .catch((error) => {
        port?.postMessage({
          ok: false,
          error: error?.message || "Offline preparation failed.",
        });
      })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);

        if (cached) return cached;

        const response = await fetch(request);

        if (response.ok) {
          await cache.put(request, response.clone());
        }

        return response;
      })()
    );

    return;
  }

  // Do not intercept API calls, Supabase, or Next.js RSC requests.
  if (request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const paths = await getShellPaths(cache);

        if (paths.includes(url.pathname)) {
          const shellUrl = new URL(url.pathname, self.location.origin);
          const cached = await cache.match(shellUrl.href);

          if (cached) return cached;
        }

        throw error;
      }
    })()
  );
});