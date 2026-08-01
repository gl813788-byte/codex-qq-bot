import { createServer } from "node:http";

export function createHubHttpServer(dependencies = {}) {
  return createServer((request, response) => handleHubHttpRequest(request, response, dependencies));
}

export async function handleHubHttpRequest(req, res, {
  handleApi,
  handleDashboardAsset,
  sendJson,
  logger,
  oneBotWebhookLimiter,
  shutdownSignal
} = {}) {
  try {
    if (req.url?.startsWith("/api/")) {
      const requestPath = new URL(req.url, "http://localhost").pathname;
      const handled = requestPath === "/api/onebot/event"
        ? await oneBotWebhookLimiter.run(() => handleApi(req, res), { signal: shutdownSignal })
        : await handleApi(req, res);
      if (handled !== false) return;
    }
    if (await handleDashboardAsset(req, res)) return;
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    logger.error("HTTP API request failed", {
      method: req.method,
      url: req.url,
      error
    }, "web");
    const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;
    sendJson(res, statusCode, { error: statusCode === 500 ? "Internal server error" : error.message });
  }
}
