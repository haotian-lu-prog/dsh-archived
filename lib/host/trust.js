// Request trust for the destructive routes.
//
// Loopback, marker-header, same-origin. The routes are destructive, so they
// refuse anything that is not this browser talking to this server.
//
// `Origin` is authoritative when present, but browsers omit it on same-origin
// GETs — so that case falls back to Fetch Metadata's `sec-fetch-site`, which a
// cross-site caller cannot forge. A request with neither signal is refused.

export const HEADER = "x-dsh-archived-sessions";

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

export function isTrustedRequest(request) {
  if (header(request, HEADER) !== "1") return false;
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false;
  const site = header(request, "sec-fetch-site");
  if (site !== undefined && site !== "same-origin") return false;
  const host = header(request, "host");
  if (!host) return false;
  const origin = header(request, "origin");
  if (origin === undefined) return site === "same-origin";
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
