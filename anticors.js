// src/proxy.ts
var proxy_default = {
  async fetch(request, env, ctx) {
    // Early return for invalid requests
    const url = new URL(request.url);
    const proxyUrl = url.searchParams.get("url");
    if (!proxyUrl) {
      return new Response("Bad request: Missing `url` query param", { status: 400 });
    }

    // Basic CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": getOrigin(request),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, DELETE",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };

    // Add expose headers only for torrents endpoint
    if (proxyUrl === "https://api.real-debrid.com/rest/1.0/torrents") {
      corsHeaders["Access-Control-Expose-Headers"] = "x-total-count";
    }

    // Freeze headers for better performance
    const frozenCorsHeaders = Object.freeze(corsHeaders);

    // Quick return for OPTIONS with aggressive caching
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...frozenCorsHeaders,
          "Access-Control-Max-Age": "86400",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }

    // Validate URL early
    const ALLOWED_HOSTS = new Set(["app.real-debrid.com", "api.real-debrid.com", "api.alldebrid.com"]);
    let parsedProxyUrl;
    try {
      parsedProxyUrl = new URL(proxyUrl);
      if (!ALLOWED_HOSTS.has(parsedProxyUrl.hostname)) {
        return new Response("Host not allowed", { status: 403 });
      }
    } catch {
      return new Response("Invalid URL", { status: 400 });
    }

    // Add cache buster only for non-GET requests
    if (request.method !== 'GET') {
      parsedProxyUrl.searchParams.set("t", Date.now().toString());
    }

    // Copy query params efficiently
    for (const [key, value] of url.searchParams) {
      if (key !== "url") parsedProxyUrl.searchParams.append(key, value);
    }

    // Efficient headers handling
    const reqHeaders = new Headers();
    for (const header of ["authorization"]) {
      const value = request.headers.get(header);
      if (value) reqHeaders.set(header, value);
    }

    // Stream the request body for POST/PUT/PATCH
    const reqInit = {
      method: request.method,
      headers: reqHeaders
    };

    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      reqInit.body = request.body;
    }

    try {
      const res = await fetch(parsedProxyUrl.toString(), reqInit);
      
      // Stream the response
      const responseHeaders = new Headers({
        ...frozenCorsHeaders
      });

      // Efficient header copying
      for (const [key, value] of res.headers) {
        if (key.toLowerCase().startsWith("x-")) {
          responseHeaders.set(key, value);
        }
      }

      return new Response(res.body, {
        status: res.status,
        headers: responseHeaders
      });
    } catch (error) {
      return new Response("Gateway error", { status: 502 });
    }
  }
};

// Helper function to determine correct origin
function getOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin === "https://beta.debridmediamanager.com") return origin;
  if (origin === "http://localhost:3000") return origin;
  return "https://debridmediamanager.com";
}

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/anticors":
        return proxy_default.fetch(request, env, ctx);
    }
    return new Response(
      `<a href="${url.origin}/anticors?url=https://api.real-debrid.com/rest/1.0/time/iso">Proxy</a>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
