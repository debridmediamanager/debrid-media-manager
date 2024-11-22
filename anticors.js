// src/proxy.ts
var proxy_default = {
  async fetch(request, env, ctx) {
    // Common CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": getOrigin(request),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Expose-Headers": "x-total-count"
    };

    // Handle OPTIONS requests immediately with permanent caching
    if (request.method === "OPTIONS") {
      const headers = new Headers({
        ...corsHeaders,
        "Access-Control-Max-Age": "31536000", // 1 year
        "Cache-Control": "public, max-age=31536000, immutable" // Cache forever
      });
      return new Response(null, { status: 200, headers });
    }

    // Handle all other requests
    const url = new URL(request.url);
    const proxyUrl = url.searchParams.get("url");
    if (!proxyUrl) {
      return new Response("Bad request: Missing `url` query param", { status: 400 });
    }

    const ALLOWED_HOSTS = ["app.real-debrid.com", "api.real-debrid.com", "api.alldebrid.com"];
    let parsedProxyUrl;
    try {
      parsedProxyUrl = new URL(proxyUrl);
    } catch (e) {
      return new Response("Bad request: Invalid `url` query param", { status: 400 });
    }

    if (!ALLOWED_HOSTS.includes(parsedProxyUrl.hostname)) {
      return new Response("Host is not allowed", { status: 403 });
    }

    // Add cache buster
    parsedProxyUrl.searchParams.set("t", crypto.randomUUID());

    // Copy all other query params except 'url'
    url.searchParams.forEach((value, key) => {
      if (key !== "url") {
        parsedProxyUrl.searchParams.append(key, value);
      }
    });

    // Build headers for proxy request
    const reqHeaders = new Headers();
    const headersToProxy = ["authorization", "content-type"];
    for (const header of headersToProxy) {
      if (request.headers.has(header)) {
        reqHeaders.set(header, request.headers.get(header));
      }
    }

    // Handle request body for POST/PUT/PATCH
    let reqBody = null;
    if (["POST", "PUT", "PATCH"].includes(request.method) && request.headers.get("content-type")) {
      if (request.headers.get("content-type").includes("application/json")) {
        reqBody = JSON.stringify(await request.json());
      } else {
        reqBody = await request.text();
      }
    }

    // Make proxy request
    let res;
    try {
      res = await fetch(parsedProxyUrl.toString(), {
        method: request.method,
        headers: reqHeaders,
        body: reqBody
      });
    } catch (error) {
      return new Response("Error fetching the proxy URL", { status: 500 });
    }

    // Build response headers with consistent CORS headers
    const responseHeaders = new Headers({
      ...corsHeaders,
      "Cache-Control": "no-store, private"
    });

    // Copy specific headers from proxy response
    const headersToKeep = ["content-length", "content-type"];
    for (const [key, value] of res.headers.entries()) {
      if (key.toLowerCase().startsWith("x-") || headersToKeep.includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    return new Response(await res.text(), {
      status: res.status,
      headers: responseHeaders
    });
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
