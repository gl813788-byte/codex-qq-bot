export function createQqSocialBridgeClient({
  baseUrl = "",
  fetchImpl = fetch,
  timeoutMs = 10_000
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const configured = Boolean(normalizedBaseUrl);

  async function request(endpoint, payload = {}) {
    const path = String(endpoint || "").replace(/^\/+/, "");
    if (!configured) {
      return {
        ok: false,
        configured: false,
        unavailable: true,
        ambiguous: false,
        status: null,
        body: {},
        endpoint: path,
        error: "social_bridge_not_configured"
      };
    }
    try {
      const response = await fetchImpl(`${normalizedBaseUrl}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const body = await readJsonResponse(response);
      const missingRoute = response.status === 404 && String(body?.error || "") !== "request_not_found";
      return {
        ok: response.ok && (body?.ok === true || body?.status === "ok" || Number(body?.code) === 0),
        configured: true,
        unavailable: missingRoute,
        ambiguous: false,
        status: response.status,
        body,
        endpoint: path,
        error: String(body?.error || body?.message || body?.wording || "")
      };
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      return {
        ok: false,
        configured: true,
        unavailable: false,
        ambiguous: true,
        timedOut,
        status: null,
        body: {},
        endpoint: path,
        error: String(error?.message || error || "social_bridge_request_failed")
      };
    }
  }

  return {
    configured,
    request,
    listPendingRequests: ({ count = 100 } = {}) => request("pending-requests", { count }),
    handleRequest: (payload) => request("handle-request", payload),
    joinGroup: (payload) => request("join-group", payload)
  };
}

async function readJsonResponse(response) {
  try {
    if (typeof response?.json === "function") return await response.json();
    if (typeof response?.text === "function") {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
  } catch {
    return {};
  }
  return {};
}
