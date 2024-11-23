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
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
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
    const ALLOWED_HOSTS = new Set(["app.real-debrid.com", "api.real-debrid.com", "api.alldebrid.com", "real-debrid.com"]);
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

    // Enhanced headers with optimizations from the curl request
    const reqHeaders = new Headers({
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "Priority": "u=1, i",
    });

    // Copy important headers from original request
    const headersToKeep = ["authorization", "cookie", "referer"];
    for (const header of headersToKeep) {
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
      
      // Stream the response with enhanced headers
      const responseHeaders = new Headers({
        ...frozenCorsHeaders
      });

      // Copy important response headers
      for (const [key, value] of res.headers) {
        if (key.toLowerCase().startsWith("x-") || 
            ["content-encoding", "content-type", "content-length", "set-cookie"].includes(key.toLowerCase())) {
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
