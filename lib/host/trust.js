// Request trust for the destructive routes.
//
// Loopback, and provably not cross-site. The routes are destructive, so they
// refuse anything that is not this browser talking to this server.
//
// The shipped web client is not the only client: the Desktop app talks to the
// same host, and a request that reaches us through the app's own pipeline can
// arrive without the Fetch Metadata headers a page-initiated fetch carries.
// Requiring `sec-fetch-site: same-origin` outright therefore rejected the
// Desktop app's perfectly legitimate same-origin call. What actually has to
// hold is: loopback, not cross-site, and either the marker header or a proven
// same-origin signal.
//
//   * cross-site is always refused — that is the CSRF case, and every browser
//     that matters sends `sec-fetch-site` for it;
//   * `Origin`, when present, must match `Host` (browsers omit it on
//     same-origin GETs, which is why it cannot be required);
//   * a request with no signals at all needs the marker header, which a
//     cross-origin page cannot set without a preflight this server never
//     approves.

export const HEADER = "x-dsh-archived";

/** The pre-rename marker, still accepted so an open tab survives the rename. */
export const LEGACY_HEADER = "x-dsh-archived-sessions";

export function header(request, key) {
  const value = request.headers?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  return (
    address === "localhost" ||
    address === "localhost." ||
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.")
  );
}

/** Whether the request's `Origin` names this very host. */
function originMatchesHost(origin, host) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackAddress(url.hostname) &&
      url.host === host
    );
  } catch {
    return false;
  }
}

/**
 * The full trust decision, with the evidence that produced it.
 *
 * @returns `{ trusted, ... }` — the reasons are kept so a refused request can
 * be reported instead of vanishing, which is what made the Desktop-app failure
 * invisible for a whole round of debugging.
 */
export function trustReport(request) {
  const marker = header(request, HEADER) ?? header(request, LEGACY_HEADER);
  const site = header(request, "sec-fetch-site");
  const host = header(request, "host");
  const origin = header(request, "origin");
  const loopback = isLoopbackAddress(request.socket?.remoteAddress);
  // A present Origin or Fetch Metadata signal is authoritative and cannot be
  // overridden by the marker: a mismatch is fatal on its own.
  const originOk = origin === undefined || originMatchesHost(origin, host);
  const siteOk = site === undefined || site === "same-origin";
  // A same-origin signal is something a cross-origin page cannot produce, so it
  // proves the caller on its own. The marker covers the case where no Fetch
  // Metadata header arrives at all (a non-browser client, or the Desktop app's
  // own request pipeline).
  const provenSameOrigin = (origin !== undefined && originOk) || site === "same-origin";
  const trusted = loopback && Boolean(host) && originOk && siteOk && (marker === "1" || provenSameOrigin);
  return {
    trusted,
    marker: marker ?? null,
    loopback,
    host: host ?? null,
    site: site ?? null,
    origin: origin ?? null,
    originOk,
    siteOk,
    provenSameOrigin,
  };
}

export function isTrustedRequest(request) {
  return trustReport(request).trusted;
}

export function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

/** Short operator-facing cause for a 500 body; these routes are loopback-only. */
export function failureDetail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
