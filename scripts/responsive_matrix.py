"""Measure supplied routes at the complete responsive viewport matrix.

The harness attaches to an existing Chrome profile over CDP. It never starts
Chrome and records geometry, text legibility, content state, and full-page
screenshots. A state manifest and a selector-level scroll allowlist keep
content blockers and intentional scrollers explicit in the report.
"""

import argparse
import base64
import itertools
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import websocket


VIEWPORTS = [
    (320, 568),
    (390, 844),
    (430, 932),
    (768, 1024),
    (1024, 768),
    (1280, 800),
    (1440, 900),
    (1920, 1080),
]


AUTH_USER_FIXTURE_SCRIPT = r"""(() => {
  const fixtureUrl = url => String(url || '').includes('/rest/1.0/user');
  const fixtureBody = JSON.stringify({
    id: 100000000,
    username: 'responsive-audit-user',
    email: 'responsive-audit@example.invalid',
    premium: 1,
    type: 'premium',
  });
  const musicFixtureBody = JSON.stringify({
    albums: [{
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mbid: 'responsive-audit-mbid',
      artist: 'Responsive Fixture Orchestra',
      album: 'A Very Long Responsive Album Title For Layout Review',
      year: 2024,
      coverUrl: null,
      tracks: [{
        id: 'responsive-audit-track',
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        fileId: 1,
        link: '',
        path: 'Responsive Fixture Orchestra/A Very Long Responsive Album Title/01 - A Long Fixture Track Name.flac',
        bytes: 73400320,
        trackNumber: 1,
        filename: '01 - A Long Fixture Track Name.flac',
      }],
      totalBytes: 73400320,
      trackCount: 1,
    }],
    totalAlbums: 1,
    totalTracks: 1,
    page: 1,
    limit: 24,
    hasMore: false,
    nextPage: null,
  });
  const fixtureResponse = (body) => new Response(body, {
    status: 200,
    headers: {'Content-Type': 'application/json'},
  });
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (fixtureUrl(url)) {
      return Promise.resolve(fixtureResponse(fixtureBody));
    }
    if (String(url || '').includes('/api/music/library')) {
      return Promise.resolve(fixtureResponse(musicFixtureBody));
    }
    return originalFetch.call(this, input, init);
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__dmmFixtureUser = fixtureUrl(url);
    this.__dmmFixtureMusic = String(url || '').includes('/api/music/library');
    if (this.__dmmFixtureUser || this.__dmmFixtureMusic) return;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function() {
    if (this.__dmmFixtureUser || this.__dmmFixtureMusic) return;
    return xhrHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    if (!this.__dmmFixtureUser && !this.__dmmFixtureMusic) return xhrSend.apply(this, arguments);
    const request = this;
    queueMicrotask(() => {
      Object.defineProperty(request, 'readyState', {configurable: true, value: 4});
      Object.defineProperty(request, 'status', {configurable: true, value: 200});
      Object.defineProperty(request, 'statusText', {configurable: true, value: 'OK'});
      const body = request.__dmmFixtureMusic ? musicFixtureBody : fixtureBody;
      Object.defineProperty(request, 'responseText', {configurable: true, value: body});
      Object.defineProperty(request, 'response', {configurable: true, value: body});
      request.getAllResponseHeaders = () => 'content-type: application/json\\r\\n';
      request.dispatchEvent(new Event('readystatechange'));
      request.dispatchEvent(new Event('load'));
      request.dispatchEvent(new Event('loadend'));
    });
  };
})();"""


# Read-only live-data transport. The isolated target has no database and the
# RD auth proxy answers only the production origin, so its pages cannot load
# their real data on their own. With --live-api the harness pauses the page's
# own API requests over CDP and answers them itself: DMM API reads go to the
# production site, and authenticated Real-Debrid reads go straight to RD with
# the page's own bearer header. Anything that can change state is refused.
PROD_ORIGIN = "https://debridmediamanager.com"
# GET routes that write: casting, link deletion and report/submission paths.
DMM_WRITE_PATH = re.compile(
    r"/(?:cast|deletelink|delete|save|saveProfile|update\w*|add\w*|report|submit|request|"
    r"grab|exportdl|nzb2rd|debrid-uploader|scrapers|sponsor|plugins|emby-plugins|test)(?:/|$|\?)",
    re.I,
)
# POST routes that only read: cache/availability lookups and the search token.
DMM_READ_POSTS = ("/api/availability/check", "/api/availability/check2", "/api/availability/ad/check",
                  "/api/availability/tb/check", "/api/torrents/stats/bulk")
# Signed challenges and clock reads expire; replaying a cached one fails auth.
UNCACHED = re.compile(r"/api/challenge|/time/iso")
# Headers the browser adds itself or that describe the test origin.
DROP_HEADERS = {"host", "origin", "referer", "cookie", "content-length", "accept-encoding",
                "connection", "user-agent"}
RD_READ_PATH = re.compile(
    r"^/rest/1\.0/(?:user|time/iso|torrents|torrents/info/[A-Z0-9]+|downloads|traffic(?:/details)?|settings)$"
)


class LiveTransport:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.cache = {}
        self.log = []

    def patterns(self):
        return [
            {"urlPattern": self.base + "/api/*", "requestStage": "Request"},
            {"urlPattern": "*://*.cors.debridmediamanager.com/*", "requestStage": "Request"},
            {"urlPattern": "*://anticors.debridmediamanager.com/*", "requestStage": "Request"},
            {"urlPattern": "*://*.real-debrid.com/rest/*", "requestStage": "Request"},
        ]

    def decide(self, method, url):
        """Return (upstream URL, kind) or (None, reason) for a paused request."""
        parsed = urllib.parse.urlsplit(url)
        if url.startswith(self.base + "/api/"):
            path = parsed.path
            if method == "GET" and not DMM_WRITE_PATH.search(path):
                return PROD_ORIGIN + path + ("?" + parsed.query if parsed.query else ""), "dmm"
            if method == "POST" and path in DMM_READ_POSTS:
                return PROD_ORIGIN + path + ("?" + parsed.query if parsed.query else ""), "dmm"
            return None, "dmm write refused"
        if parsed.hostname and parsed.hostname.endswith("debridmediamanager.com"):
            target = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
        else:
            target = url
        target_parts = urllib.parse.urlsplit(target)
        if (target_parts.hostname or "").endswith("real-debrid.com") and method in ("GET", "OPTIONS") \
                and RD_READ_PATH.match(target_parts.path):
            return "https://api.real-debrid.com" + target_parts.path + (
                "?" + target_parts.query if target_parts.query else ""), "rd"
        return None, "provider request refused"

    def handle(self, page, event):
        request = event["request"]
        method = request["method"]
        url = request["url"]
        upstream, kind = self.decide(method, url)
        entry = {"method": method, "url": re.sub(r"(apikey|token|auth)=[^&]+", r"\1=REDACTED", url),
                 "kind": kind}
        cors = [{"name": "Access-Control-Allow-Origin", "value": self.base},
                {"name": "Access-Control-Allow-Credentials", "value": "true"},
                {"name": "Access-Control-Allow-Headers", "value": "*, Authorization, Content-Type"},
                {"name": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS"},
                {"name": "Access-Control-Expose-Headers", "value": "X-Total-Count"}]
        if upstream is None:
            self.log.append(entry)
            page.call("Fetch.failRequest", {"requestId": event["requestId"], "errorReason": "BlockedByClient"})
            return
        if method == "OPTIONS":
            self.log.append({**entry, "status": 204})
            page.call("Fetch.fulfillRequest", {"requestId": event["requestId"], "responseCode": 204,
                                               "responseHeaders": cors})
            return
        # The page's own credential headers go with its request, as they would
        # from the production origin: RD's bearer token, and the provider-key
        # headers DMM's transfer/request/cast reads take.
        headers = {"User-Agent": "dmm-responsive-audit (read-only)"}
        for name, value in request["headers"].items():
            if name.lower() not in DROP_HEADERS and not name.lower().startswith("sec-"):
                headers[name] = value
        body = request.get("postData", "").encode() if method == "POST" else None
        key = (method, upstream, json.dumps(headers, sort_keys=True), body)
        if UNCACHED.search(upstream):
            self.cache.pop(key, None)
        if key not in self.cache:
            try:
                response = urllib.request.urlopen(
                    urllib.request.Request(upstream, data=body, headers=headers, method=method), timeout=60)
                self.cache[key] = (response.status, dict(response.headers), response.read())
            except urllib.error.HTTPError as error:
                self.cache[key] = (error.code, dict(error.headers), error.read())
            except Exception as error:
                self.cache[key] = (502, {"Content-Type": "text/plain"}, str(error).encode())
        status, response_headers, content = self.cache[key]
        self.log.append({**entry, "status": status})
        keep = [{"name": name, "value": value} for name, value in response_headers.items()
                if name.lower() in ("content-type", "cache-control", "x-total-count", "location")]
        page.call("Fetch.fulfillRequest", {
            "requestId": event["requestId"], "responseCode": status,
            "responseHeaders": keep + (cors if kind == "rd" else []),
            "body": base64.b64encode(content).decode(),
        })


class Page:
    def __init__(self, endpoint: str, fixture_auth_user: bool = False, transport=None):
        self.endpoint = endpoint.rstrip("/")
        self.fixture_auth_user = fixture_auth_user
        self.transport = transport
        self.results = {}
        self.settle_timeout = 14.0
        request = urllib.request.Request(self.endpoint + "/json/new?about:blank", method="PUT")
        info = json.load(urllib.request.urlopen(request))
        self.page_id = info["id"]
        self.ws = websocket.create_connection(
            info["webSocketDebuggerUrl"], suppress_origin=True, timeout=45
        )
        self.ids = itertools.count(1)
        self.call("Page.enable")
        self.call("Network.enable")
        self.call("Network.setCacheDisabled", {"cacheDisabled": True})
        self.call("Network.setBypassServiceWorker", {"bypass": True})
        self.call("Emulation.setFocusEmulationEnabled", {"enabled": True})
        # A full-page capture drops the classic scrollbar and lays the page out
        # that much wider, so a clip taken from the scrolled layout cut the
        # right 15px off every screenshot. Phones overlay their scrollbars
        # anyway; hiding them keeps measurement and capture on one width.
        self.call("Emulation.setScrollbarsHidden", {"hidden": True})
        if self.fixture_auth_user:
            self.call("Page.addScriptToEvaluateOnNewDocument", {"source": AUTH_USER_FIXTURE_SCRIPT})
        if self.transport:
            self.call("Fetch.enable", {"patterns": self.transport.patterns()})

    def call(self, method, params=None):
        call_id = next(self.ids)
        self.ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        while True:
            # A paused request is answered with nested calls, so their replies
            # can arrive while an outer call waits; keep every reply by id.
            if call_id in self.results:
                event = self.results.pop(call_id)
                if "error" in event:
                    raise RuntimeError(event["error"])
                return event.get("result", {})
            event = json.loads(self.ws.recv())
            if "id" in event:
                self.results[event["id"]] = event
            elif event.get("method") == "Fetch.requestPaused" and self.transport:
                self.transport.handle(self, event["params"])

    def pump(self, seconds):
        """Sleep while still answering paused requests."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.evaluate("0")
            time.sleep(0.05)

    def evaluate(self, expression):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")

    def viewport(self, width, height):
        self.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False},
        )

    def settle(self, timeout=14.0):
        """Wait for route identity/content to stop changing, not for a fixed delay.

        A page still showing a loading indicator or waiting on images is not
        settled, however long it has been stable; it is returned at the
        deadline and classified as loading.
        """
        deadline = time.monotonic() + timeout
        previous = None
        stable = 0
        latest = None
        while time.monotonic() < deadline:
            latest = self.evaluate(
                r"""(() => {
                  const body = (document.body?.innerText || '').trim();
                  const loading = [...document.querySelectorAll('*')].filter(el =>
                    /loading(?:\.\.\.|…)?/i.test((el.textContent || '').trim()) &&
                    getComputedStyle(el).display !== 'none').length;
                  const pendingImages = [...document.images].filter(img => !img.complete).length;
                  const identity = JSON.stringify({
                    url: location.href,
                    title: document.title,
                    body: body.slice(0, 16000),
                    heading: document.querySelector('h1,h2')?.textContent?.trim() || '',
                    loading,
                    pendingImages,
                  });
                  return {identity, url: location.href, title: document.title, body,
                    loading, pendingImages};
                })()"""
            )
            busy = latest and (latest["loading"] or latest["pendingImages"])
            if latest and latest["identity"] == previous and not busy:
                stable += 1
            else:
                stable = 0
            previous = latest["identity"] if latest else None
            if stable >= 3:
                return latest
            self.pump(0.25)
        return latest or {"url": "", "title": "", "body": "", "loading": 0, "pendingImages": 0}

    def navigate(self, url):
        # Route changes can leave fragment-driven React state and session
        # storage from the previous route alive. Start each requested route as
        # a fresh document while retaining localStorage authentication.
        try:
            self.evaluate("sessionStorage.clear(); window.scrollTo(0, 0)")
        except Exception:
            pass
        self.call("Page.navigate", {"url": "about:blank"})
        time.sleep(0.05)
        result = self.call("Page.navigate", {"url": url})
        if result.get("errorText"):
            raise RuntimeError(result["errorText"] + ": " + url)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.evaluate("document.readyState === 'complete'"):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Page did not finish loading: " + url)
        self.evaluate("document.fonts?.ready?.then(() => true) || true")
        settled = self.settle(self.settle_timeout)
        # Visit every viewport section once so lazy content and image-backed
        # cards are present before the measurement and full-page capture.
        self.evaluate(
            r"""(async () => {
              const limit = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
              const step = Math.max(window.innerHeight, 240);
              for (let y = 0; y < limit; y += step) {
                window.scrollTo({top: y, behavior: "instant"});
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                // Lazy images only start once they near the viewport; give the
                // ones now in view time to arrive before scrolling past them.
                const inView = [...document.images].filter(img => {
                  const r = img.getBoundingClientRect();
                  return !img.complete && r.bottom > 0 && r.top < window.innerHeight;
                });
                await Promise.race([
                  Promise.all(inView.map(img => img.decode().catch(() => null))),
                  new Promise(resolve => setTimeout(resolve, 4000)),
                ]);
              }
              window.scrollTo({top: 0, behavior: "instant"});
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return true;
            })()"""
        )
        after_reveal = self.settle(self.settle_timeout)
        return after_reveal or settled

    def screenshot_full(self):
        metrics = self.call("Page.getLayoutMetrics")
        css_size = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
        width = max(1, float(css_size.get("width", 1)))
        height = max(1, float(css_size.get("height", 1)))
        result = self.call(
            "Page.captureScreenshot",
            {
                "format": "png",
                "fromSurface": True,
                "captureBeyondViewport": True,
                "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
            },
        )
        return base64.b64decode(result["data"])

    def screenshot_tiles(self, width, height, destination):
        scroll = self.evaluate("({height: document.documentElement.scrollHeight, y: window.scrollY})")
        content_height = int(scroll.get("height", height))
        paths = []
        try:
            for index, y in enumerate(range(0, content_height, height)):
                self.evaluate(f"window.scrollTo(0, {y})")
                time.sleep(0.08)
                result = self.call("Page.captureScreenshot", {"format": "png", "fromSurface": True})
                path = destination.with_name(destination.stem + f"-tile-{index:03d}.png")
                path.write_bytes(base64.b64decode(result["data"]))
                paths.append(str(path))
        finally:
            self.evaluate(f"window.scrollTo(0, {scroll.get('y', 0)})")
        return paths

    def close(self):
        self.ws.close()
        urllib.request.urlopen(self.endpoint + "/json/close/" + self.page_id).read()


MEASURE = r"""(() => {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const visible = el => {
    if (!el) return false;
    // Next injects this live-region announcer just outside the viewport. It is
    // framework infrastructure rather than page content and has intentional
    // overflow/positioning that must not become a responsive finding.
    if (el.id === '__next-route-announcer__' || el.closest('#__next-route-announcer__')) return false;
    // Screen-reader-only controls are intentionally one-pixel and clipped;
    // they must not be treated as visible layout or overflow defects.
    if (typeof el.className === 'string' && /(^|\s)sr-only(\s|$)/.test(el.className)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open) return false;
    }
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' &&
      Number.parseFloat(s.opacity) > 0;
  };
  const directText = el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.nodeValue || '').join(' ').trim().replace(/\s+/g, ' ');
  const identify = (el, r = el.getBoundingClientRect()) => ({
    tag: el.tagName,
    text: (directText(el) || (el.textContent || '').trim()).replace(/\s+/g, ' ').slice(0, 160),
    id: el.id || '',
    class: typeof el.className === 'string' ? el.className : '',
    box: {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height},
  });
  const style = el => {
    const s = getComputedStyle(el);
    return {display: s.display, position: s.position, overflowX: s.overflowX,
      overflowY: s.overflowY, fontSize: s.fontSize, lineHeight: s.lineHeight,
      fontWeight: s.fontWeight, color: s.color, backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage, opacity: s.opacity, textOverflow: s.textOverflow,
      whiteSpace: s.whiteSpace, tabIndex: el.tabIndex, role: el.getAttribute('role') || ''};
  };
  const parseColor = value => {
    if (!value || value === 'transparent') return {rgb: [0, 0, 0], alpha: 0};
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(',').map(part => part.trim());
    if (parts.length < 3) return null;
    const rgb = parts.slice(0, 3).map(part => Number.parseFloat(part));
    if (rgb.some(Number.isNaN)) return null;
    const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    return {rgb, alpha: Number.isNaN(alpha) ? 1 : alpha};
  };
  const composite = (foreground, background) => {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
    if (alpha === 0) return {rgb: [0, 0, 0], alpha: 0};
    return {rgb: foreground.rgb.map((channel, index) =>
      (channel * foreground.alpha + background.rgb[index] * background.alpha * (1 - foreground.alpha)) / alpha), alpha};
  };
  // CSS backgrounds are painted from the document canvas inward. Keep every
  // ancestor in that order; stopping at body or the first opaque node loses a
  // nearer panel background and reports false contrast failures.
  const backgroundFor = el => {
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.push(node);
    let background = {rgb: [255, 255, 255], alpha: 1};
    const sources = [];
    const needsVisualResolution = [];
    for (const node of chain.reverse()) {
      const computed = getComputedStyle(node);
      const label = node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '');
      if (computed.backgroundImage && computed.backgroundImage !== 'none')
        needsVisualResolution.push({kind: 'background-image', element: label, value: computed.backgroundImage});
      if (Number.parseFloat(computed.opacity) < 1)
        needsVisualResolution.push({kind: 'opacity', element: label, value: computed.opacity});
      const color = parseColor(computed.backgroundColor);
      if (color && color.alpha > 0) {
        background = composite(color, background);
        sources.push({element: label, color, composite: background});
      }
    }
    return {color: background, sources, needsVisualResolution};
  };
  const luminance = color => color.rgb.map(channel => channel / 255).map(channel =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const textElements = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if ((node.nodeValue || '').trim() && visible(node.parentElement)) textElements.add(node.parentElement);
  }
  const controls = [...document.querySelectorAll('button, input, select, textarea, summary, nav a, a.btn, a[role="button"], [role="menuitem"]')].filter(visible);
  // A checkbox or radio has a value ("on") but no text; its colour is the tick.
  const textless = el => el.matches('input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"]');
  for (const control of controls) {
    if (textless(control)) continue;
    if (control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.value)
      textElements.add(control);
  }
  const textCandidates = [...textElements].filter(el => visible(el));
  const contrast = textCandidates.map(el => {
    const computed = getComputedStyle(el);
    const foreground = parseColor(computed.color);
    if (!foreground) return null;
    const background = backgroundFor(el);
    const resolvedForeground = composite(foreground, background.color);
    const ratio = (Math.max(luminance(resolvedForeground), luminance(background.color)) + 0.05) /
      (Math.min(luminance(resolvedForeground), luminance(background.color)) + 0.05);
    const fontSize = parseFloat(computed.fontSize);
    const fontWeight = Number.parseInt(computed.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.667 && fontWeight >= 700);
    return {element: identify(el), ratio, required: large ? 3 : 4.5, fontSize,
      fontWeight: computed.fontWeight, foreground, background: background.color,
      backgroundSources: background.sources, needsVisualResolution: background.needsVisualResolution};
  }).filter(Boolean);
  const contrastIssues = contrast.filter(item => item.ratio + 0.001 < item.required && !item.needsVisualResolution.length);
  const contrastVisualReview = contrast.filter(item => item.ratio + 0.001 < item.required && item.needsVisualResolution.length);
  const inScroller = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (['auto', 'scroll', 'clip'].includes(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const allVisible = [...document.querySelectorAll('*')].filter(visible);
  const all = [...document.querySelectorAll('main, main *, header, header *, footer, footer *, [role="dialog"], [role="menu"]')].filter(visible);
  const geometry = all.map(el => ({...identify(el), style: style(el)}));
  const overflow = allVisible.filter(el => !inScroller(el)).filter(el => {
    const r = el.getBoundingClientRect();
    return r.left < -1 || r.right > width + 1;
  }).map(el => identify(el));
  const smallText = textCandidates.filter(el => parseFloat(getComputedStyle(el).fontSize) < 14).map(el => identify(el));
  const clippedText = textCandidates.filter(el => {
    const s = getComputedStyle(el);
    return el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(s.overflowX) &&
      (s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis' || s.lineClamp !== 'none');
  }).map(el => identify(el));
  const intentionalClip = el => el.id === '__next-route-announcer__' ||
    /(^|\s)(truncate|line-clamp-\d+)(\s|$)/.test(typeof el.className === 'string' ? el.className : '') ||
    inScroller(el) ||
    (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll', 'clip'].includes(getComputedStyle(el).overflowX));
  const clippedTextDefects = textCandidates.filter(el => {
    const s = getComputedStyle(el);
    return el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(s.overflowX) &&
      (s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis' || s.lineClamp !== 'none') && !intentionalClip(el);
  }).map(el => identify(el));
  const smallControls = controls.filter(el => {
    const r = el.getBoundingClientRect();
    return r.height < 43.5 || r.width < 43.5;
  }).map(el => identify(el));
  const navigation = [...document.querySelectorAll('header nav a')].filter(visible);
  // A failed image is broken wherever it is. One still loading is broken
  // when it sits in the first screen after the reveal pass has had it in
  // view; further down it can be a card an infinite list appended during
  // that pass, which is recorded but not a failure.
  const loadedBroken = el => el.complete && !el.naturalWidth;
  const stillLoading = el => !el.complete;
  // In the first screen means actually on it: inside the viewport and inside
  // every clipping scroller, since a lazy image off to the side of a
  // horizontal row correctly waits until that row is scrolled.
  const inFirstScreen = el => {
    let r = el.getBoundingClientRect();
    let box = {left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight};
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const c = node.getBoundingClientRect();
        box = {left: Math.max(box.left, c.left), top: Math.max(box.top, c.top),
          right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom)};
      }
    }
    return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
  };
  const brokenImages = [...document.images].filter(visible)
    .filter(el => loadedBroken(el) || (stillLoading(el) && inFirstScreen(el))).map(el => el.src);
  const unloadedImages = [...document.images].filter(visible)
    .filter(el => stillLoading(el) && !inFirstScreen(el)).map(el => el.src);
  const ephemeral = el => {
    if (el.closest('[role="status"], [role="alert"]')) return true;
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const position = getComputedStyle(parent).position;
      if (['absolute', 'fixed'].includes(position) && parent.querySelector('[role="status"], [role="alert"]'))
        return true;
    }
    return false;
  };
  const scrollRegions = allVisible.filter(el => {
    if (ephemeral(el) || inScroller(el) || el.scrollWidth <= el.clientWidth + 1) return false;
    const overflowX = getComputedStyle(el).overflowX;
    return ['auto', 'scroll', 'clip'].includes(overflowX);
  })
    .map(el => ({...identify(el), style: style(el)}));
  const collisionTargets = [...new Set([...controls, ...textCandidates, ...document.querySelectorAll('h1,h2,h3,h4,h5,h6')])]
    .filter(visible).filter(el => controls.includes(el) || !intentionalClip(el));
  const collisionBox = el => {
    if (controls.includes(el)) return el.getBoundingClientRect();
    const ranges = [...el.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && (child.nodeValue || '').trim()).map(child => {
      const range = document.createRange();
      range.selectNodeContents(child);
      return range.getBoundingClientRect();
    }).filter(rect => rect.width > 0 && rect.height > 0);
    if (!ranges.length) return el.getBoundingClientRect();
    return {
      left: Math.min(...ranges.map(rect => rect.left)),
      top: Math.min(...ranges.map(rect => rect.top)),
      right: Math.max(...ranges.map(rect => rect.right)),
      bottom: Math.max(...ranges.map(rect => rect.bottom)),
    };
  };
  const overlapElements = [];
  const positionedCollisions = [];
  // A floating control (fixed, like the library pill) overlaps whatever is
  // under it at this scroll position and scrolls clear of it; that is
  // recorded apart. What it covers at the page end is END_COVERAGE's job.
  const floatingOverlaps = [];
  const floating = el => {
    for (let node = el; node && node !== document.body; node = node.parentElement)
      if (getComputedStyle(node).position === 'fixed') return true;
    return false;
  };
  const collisionRecord = (a, b, area) => ({a: identify(a), b: identify(b), area,
    aPosition: getComputedStyle(a).position, bPosition: getComputedStyle(b).position});
  for (let i = 0; i < collisionTargets.length; i++) for (let j = i + 1; j < collisionTargets.length; j++) {
    const a = collisionTargets[i], b = collisionTargets[j];
    if (a === b || a.contains(b) || b.contains(a)) continue;
    // Toasts dismiss themselves; what they briefly cover is not a layout defect.
    if (ephemeral(a) || ephemeral(b)) continue;
    const ar = collisionBox(a), br = collisionBox(b);
    const x = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
    const y = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
    if (x * y <= 2) continue;
    const item = collisionRecord(a, b, x * y);
    if (floating(a) !== floating(b)) { floatingOverlaps.push(item); continue; }
    const positioned = ['absolute', 'fixed', 'sticky'].includes(item.aPosition) || ['absolute', 'fixed', 'sticky'].includes(item.bPosition);
    if (positioned) positionedCollisions.push(item);
    else if (controls.includes(a) || controls.includes(b)) overlapElements.push(item);
  }
  const visibleBoxes = [...document.querySelectorAll('h1,h2,button,input,select,textarea,summary,nav a,a.btn,figure,table,[role="dialog"],[role="menu"]')].filter(visible).map(el => ({...identify(el), style: style(el)}));
  const portalText = [...document.querySelectorAll('nextjs-portal, [data-nextjs-dialog]')]
    .map(el => el.shadowRoot?.innerText || el.innerText || '').join('\n');
  // Next's route announcer is visually hidden but keeps the heading it last
  // announced, which after a redirect can be the auth wrapper's transient
  // "is loading..." heading; it says nothing about this page's state.
  const announcer = document.getElementById('__next-route-announcer__')?.innerText || '';
  const pageText = (document.body?.innerText || '').replace(announcer, '');
  const bodyText = `${pageText}\n${portalText}`.trim();
  const loading = /\bloading(?:\.\.\.|…)?\b/i.test(bodyText);
  const error = /internal server error|error:\s*failed to load|failed to load data|there was an error|application error|next\.js server error|runtime\s+(?:axios)?error|axioserror/i.test(bodyText);
  const login = /\/login(?:[/?#]|$)/i.test(location.pathname) ||
    /\b(sign in|log in|connect your|enter your api key|(?:real-debrid|alldebrid|torbox|premiumize|offcloud|debrid[- ]?link)\s+required)\b/i.test(bodyText);
  const empty = /\b(no data available|no results|no .* found|empty library|(?:your )?library is empty|nothing found)\b/i.test(bodyText);
  const observedState = loading ? 'loading' : error ? 'error' : login ? 'unauthenticated' : empty ? 'empty' : 'rendered';
  return {
    width, height, viewport: {innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight},
    scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
    overflow, clippedText, clippedTextDefects, smallText, smallControls, overlapElements,
    positionedCollisions, floatingOverlaps, contrast, contrastIssues, contrastVisualReview, scrollRegions,
    navigation: navigation.length, brokenImages, unloadedImages, heading: document.querySelector('h1')?.textContent.trim() ?? null,
    main: !!document.querySelector('main'), title: document.title, url: location.href,
    bodyText: pageText.slice(0, 20000),
    observedState, geometry, visibleBoxes,
  };
})()"""


# At the end of the page nothing can scroll out from under a fixed control, so
# whatever it covers there cannot be read or pressed at all. Mid-page overlap
# by a floating control is expected and scrolls clear; this one does not.
END_COVERAGE = r"""(async () => {
  window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'});
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number.parseFloat(s.opacity) > 0;
  };
  const fixedRoot = el => {
    for (let node = el; node && node !== document.body; node = node.parentElement)
      if (getComputedStyle(node).position === 'fixed') return node;
    return null;
  };
  // Toasts are transient and dismiss themselves; they are not page chrome.
  const toast = el => el.closest('[role="status"], [role="alert"]') || el.querySelector('[role="status"], [role="alert"]');
  const fixed = [...document.querySelectorAll('body *')].filter(el => getComputedStyle(el).position === 'fixed')
    .filter(el => visible(el) && !toast(el) && el.id !== '__next-route-announcer__')
    // A click-through transparent layer (the toast container) covers nothing.
    .filter(el => !(getComputedStyle(el).pointerEvents === 'none' && !(el.textContent || '').trim()));
  const textBox = el => {
    const rects = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()).map(n => {
      const range = document.createRange(); range.selectNodeContents(n); return range.getBoundingClientRect();
    }).filter(r => r.width > 0 && r.height > 0);
    return rects;
  };
  const targets = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    if (fixedRoot(el) || !visible(el)) continue;
    const control = el.matches('button, a, input, select, textarea, summary');
    const rects = control ? [el.getBoundingClientRect()] : textBox(el);
    if (rects.length) targets.push({el, rects});
  }
  // Text an inner scroller has clipped away is not on screen to be covered.
  const clipped = (el, r) => {
    let box = {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = node.getBoundingClientRect();
      box = {left: Math.max(box.left, c.left), top: Math.max(box.top, c.top),
        right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom)};
    }
    return box;
  };
  const covered = [];
  for (const f of fixed) {
    const fr = f.getBoundingClientRect();
    for (const {el, rects} of targets) {
      for (const raw of rects) {
        const r = clipped(el, raw);
        const x = Math.min(fr.right, r.right) - Math.max(fr.left, r.left);
        const y = Math.min(fr.bottom, r.bottom) - Math.max(fr.top, r.top);
        if (x > 2 && y > 2 && r.top < innerHeight && r.bottom > 0) {
          covered.push({fixed: (f.className || f.tagName).toString().slice(0, 90),
            covered: (el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 90), area: x * y});
          break;
        }
      }
    }
  }
  window.scrollTo({top: 0, behavior: 'instant'});
  return covered;
})()"""


def slug(route):
    cleaned = route.strip("/").replace("/", "-").replace("?", "-").replace("=", "-")
    return cleaned or "home"


def load_json(path):
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def allowed_scroll(item, route, allowlist):
    for rule in allowlist:
        if rule.get("route") not in (route, "*"):
            continue
        if rule.get("id") and item.get("id") != rule["id"]:
            continue
        if rule.get("tag") and item.get("tag") != rule["tag"]:
            continue
        if rule.get("classContains") and rule["classContains"] not in item.get("class", ""):
            continue
        if rule.get("textIncludes") and rule["textIncludes"] not in item.get("text", ""):
            continue
        if rule.get("overflowX") and item.get("style", {}).get("overflowX") != rule["overflowX"]:
            continue
        if rule.get("overflowY") and item.get("style", {}).get("overflowY") != rule["overflowY"]:
            continue
        return rule.get("reason", "explicit route selector allowance")
    return None


def content_classification(route, requested, observed, manifest):
    expected = manifest.get(route, {})
    status = expected.get("status", "unmapped")
    configured_states = expected.get("observedStates")
    if configured_states is None:
        state = expected.get("state", "")
        if state == "empty":
            configured_states = ["empty"]
        elif "login" in state or state == "unauthenticated-addon":
            configured_states = ["unauthenticated"]
        elif status == "verified":
            configured_states = ["rendered"]
        else:
            configured_states = []
    observed_state = observed.get("observedState")
    state_matches = observed_state in configured_states if configured_states else None
    # A state label alone does not identify the page: a login wall, a loading
    # shell and a populated page can all read as "rendered". When the manifest
    # names the data the route must show, and the path it must end on, both
    # have to be present before the state counts.
    identity = []
    body = observed.get("bodyText") or ""
    for pattern in expected.get("expectText", []):
        if not re.search(pattern, body, re.I | re.M):
            identity.append(f"missing text /{pattern}/")
    if expected.get("expectPath"):
        path = urllib.parse.urlsplit(observed.get("url") or "").path
        if not re.fullmatch(expected["expectPath"], path):
            identity.append(f"ended on {path}, expected {expected['expectPath']}")
    if identity and state_matches:
        state_matches = False
    return {
        "expectedState": expected.get("state", "unmapped"),
        "expectedObservedStates": configured_states,
        "contentStatus": status,
        "contentReason": expected.get("reason", "No route state manifest entry"),
        "observedState": observed_state,
        "contentStateMatches": state_matches,
        "observedUrl": observed.get("url"),
        "redirected": observed.get("url") != requested,
        "identityProblems": identity,
        "contentVerified": status == "verified" and state_matches is True,
        "contentBlocked": status == "blocked",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cdp", default="http://127.0.0.1:9222")
    parser.add_argument("--routes", nargs="+", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--screenshots")
    parser.add_argument("--state-manifest")
    parser.add_argument("--scroll-allowlist")
    parser.add_argument("--require-main", action="store_true")
    parser.add_argument("--fixture-auth-user", action="store_true",
                        help="Fulfill the Real-Debrid user profile with a sanitized layout fixture.")
    parser.add_argument("--live-api", action="store_true",
                        help="Answer the page's API reads from production and RD (read-only; writes refused).")
    parser.add_argument("--rd-token-env",
                        help="Environment variable holding an RD API token to sign the page in with.")
    parser.add_argument("--guest", action="store_true",
                        help="Enter as a guest (the start page's 'Enter as Guest'), with no provider account.")
    parser.add_argument("--keep-storage", action="store_true",
                        help="Leave the sign-in in place (parallel shards share the origin's storage).")
    parser.add_argument("--settle-timeout", type=float, default=14.0)
    parser.add_argument("--viewports", nargs="+", help="Subset such as 390x844 (default: all eight).")
    args = parser.parse_args()
    manifest = load_json(args.state_manifest)
    viewports = [tuple(int(n) for n in v.split("x")) for v in args.viewports] if args.viewports else VIEWPORTS
    allowlist = load_json(args.scroll_allowlist) if args.scroll_allowlist else []
    if isinstance(allowlist, dict):
        allowlist = allowlist.get("rules", [])

    transport = LiveTransport(args.base_url) if args.live_api else None
    page = Page(args.cdp, fixture_auth_user=args.fixture_auth_user, transport=transport)
    page.settle_timeout = args.settle_timeout
    records = []
    browser = None
    fatal_error = None
    origin = urllib.parse.urlsplit(args.base_url)
    origin = f"{origin.scheme}://{origin.netloc}"
    try:
        browser = page.evaluate("navigator.userAgent")
        clear = {"origin": origin,
                 "storageTypes": "local_storage,session_storage,indexeddb,cache_storage,service_workers"}
        if args.guest and not args.rd_token_env:
            if not args.keep_storage:
                page.call("Storage.clearDataForOrigin", clear)
            page.call("Page.navigate", {"url": args.base_url.rstrip("/") + "/_offline"})
            page.pump(2)
            page.evaluate("(() => { localStorage.setItem('dmm:guest', 'true');"
                          " for (const k of ['Torrentio','Comet','MediaFusion','Peerflix','TorrentsDB'])"
                          " localStorage.setItem('settings:enable' + k, 'false'); return true; })()")
        if args.rd_token_env:
            token = os.environ[args.rd_token_env]
            # Start from empty storage: withAuth replays a stored return URL on
            # the first signed-in page, which would hijack the first route.
            # Parallel shards clear once before they start instead.
            if not args.keep_storage:
                page.call("Storage.clearDataForOrigin", clear)
            page.call("Page.navigate", {"url": args.base_url.rstrip("/") + "/_offline"})
            page.pump(2)
            # useLocalStorage JSON-parses the token; the addon toggles are raw
            # strings. External addons are off so the page shows DMM's own data.
            page.evaluate("(() => {" + f"localStorage.setItem('rd:accessToken', {json.dumps(json.dumps(token))});" +
                          "for (const k of ['Torrentio','Comet','MediaFusion','Peerflix','TorrentsDB'])"
                          " localStorage.setItem('settings:enable' + k, 'false'); return true;})()")
        for route in dict.fromkeys(args.routes):
            target = args.base_url.rstrip("/") + (route if route.startswith("/") else "/" + route)
            for width, height in viewports:
                page.viewport(width, height)
                try:
                    settled = page.navigate(target)
                    record = page.evaluate(MEASURE)
                    record["coveredAtPageEnd"] = page.evaluate(END_COVERAGE)
                    record.update(route=route, requestedUrl=target, viewportWidth=width, viewportHeight=height,
                                  settle=settled)
                    record.update(content_classification(route, target, record, manifest))
                    allowed = []
                    unallowed = []
                    for region in record["scrollRegions"]:
                        reason = allowed_scroll(region, route, allowlist)
                        (allowed if reason else unallowed).append({**region, **({"reason": reason} if reason else {})})
                    record["allowedScrollRegions"] = allowed
                    record["unallowlistedScrollRegions"] = unallowed
                    clipped_allowed = []
                    clipped_unallowed = []
                    for clipped in record["clippedTextDefects"]:
                        reason = allowed_scroll(clipped, route, allowlist)
                        (clipped_allowed if reason else clipped_unallowed).append(
                            {**clipped, **({"reason": reason} if reason else {})}
                        )
                    record["intentionalClippedText"] = clipped_allowed
                    record["clippedTextDefects"] = clipped_unallowed
                    checks = {
                        "viewportScrollWidth": record["scrollWidth"] <= record["width"] + 1,
                        "overflow": not record["overflow"],
                        "brokenImages": not record["brokenImages"],
                        "horizontalScrollAllowlist": not unallowed,
                        "textClipping": not record["clippedTextDefects"],
                        "peerOverlaps": not record["overlapElements"],
                        "positionedCollisions": not record["positionedCollisions"],
                        "coveredAtPageEnd": not record["coveredAtPageEnd"],
                    }
                    if args.require_main:
                        checks.update(main=record["main"], heading=bool(record["heading"]))
                    record["geometryChecks"] = checks
                    record["geometryPass"] = all(checks.values())
                    record["legibilityPass"] = not record["contrastIssues"] and not record["contrastVisualReview"]
                    record["passed"] = record["geometryPass"] and record["legibilityPass"] and record["contentVerified"]
                    records.append(record)
                    if args.screenshots:
                        destination = Path(args.screenshots)
                        destination.mkdir(parents=True, exist_ok=True)
                        full_path = destination / f"{slug(route)}-{width}x{height}-full.png"
                        try:
                            full_path.write_bytes(page.screenshot_full())
                            record["screenshot"] = str(full_path)
                        except Exception as screenshot_error:
                            tiles = page.screenshot_tiles(width, height, full_path)
                            record["screenshotTiles"] = tiles
                            record["screenshotError"] = str(screenshot_error)
                except Exception as error:
                    record = {"route": route, "requestedUrl": target, "viewportWidth": width,
                              "viewportHeight": height, "passed": False, "geometryPass": False,
                              "contentStatus": "blocked", "contentReason": f"measurement error: {error}",
                              "error": str(error)}
                    records.append(record)
            route_records = [r for r in records if r["route"] == route]
            print(f"{route}: geometry {sum(r.get('geometryPass', False) for r in route_records)}/{len(route_records)}, "
                  f"content verified {sum(r.get('contentVerified', False) for r in route_records)}/{len(route_records)}",
                  flush=True)
    except Exception as error:
        fatal_error = str(error)
    finally:
        try:
            if (args.rd_token_env or args.guest) and not args.keep_storage:
                page.call("Storage.clearDataForOrigin", clear)
            page.close()
        except Exception as error:
            fatal_error = fatal_error or f"browser cleanup: {error}"
    summary = {
        "total": len(records),
        "geometryPasses": sum(record.get("geometryPass", False) for record in records),
        "legibilityPasses": sum(record.get("legibilityPass", False) for record in records),
        "contentVerified": sum(record.get("contentVerified", False) for record in records),
        "contentStateMismatches": sum(record.get("contentStateMatches") is False for record in records),
        "contentBlocked": sum(record.get("contentBlocked", False) for record in records),
        "unmapped": sum(record.get("contentStatus") == "unmapped" for record in records),
        "overallPasses": sum(record.get("passed", False) for record in records),
    }
    report = {"browser": browser, "baseUrl": args.base_url, "viewports": viewports,
              "authFixture": "sanitized-rd-user-and-music" if args.fixture_auth_user else None,
              "liveApi": ("production DMM API reads and Real-Debrid reads; writes refused"
                          if args.live_api else None),
              "rdSignedIn": bool(args.rd_token_env),
              "guest": bool(args.guest and not args.rd_token_env),
              "transportLog": transport.log if transport else None,
              "routes": list(dict.fromkeys(args.routes)), "summary": summary, "measurements": records,
              "fatalError": fatal_error}
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(summary, sort_keys=True))
    print(f"Report: {args.report}")
    raise SystemExit(1 if fatal_error or summary["overallPasses"] != summary["total"] else 0)


if __name__ == "__main__":
    main()
