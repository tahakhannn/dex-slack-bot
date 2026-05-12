const MAX_GIF_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const allowedCache = new Map();

function getHeader(headers, name) {
  if (!headers) {
    return null;
  }

  if (typeof headers.get === "function") {
    return headers.get(name);
  }

  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName);
  return entry ? entry[1] : null;
}

function parseContentLength(headers) {
  const value = getHeader(headers, "content-length");
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRangeTotal(headers) {
  const value = getHeader(headers, "content-range");
  const match = String(value || "").match(/\/(\d+)$/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeGifUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : "";
  } catch (_error) {
    return "";
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyWithinLimit(response, maxBytes) {
  if (!response?.body) {
    if (typeof response?.arrayBuffer !== "function") {
      return null;
    }

    const buffer = await response.arrayBuffer();
    return buffer.byteLength <= maxBytes;
  }

  if (typeof response.body.getReader !== "function") {
    return null;
  }

  const reader = response.body.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return totalBytes <= maxBytes;
    }

    totalBytes += value?.byteLength ?? value?.length ?? 0;
    if (totalBytes > maxBytes) {
      await reader.cancel?.();
      return false;
    }
  }
}

async function probeWithGet(url, { fetchImpl, maxBytes, timeoutMs }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: {
        Range: `bytes=0-${maxBytes}`,
      },
    },
    timeoutMs,
  );

  if (!response?.ok) {
    return false;
  }

  const totalBytes = parseContentRangeTotal(response.headers);
  if (totalBytes !== null) {
    return totalBytes <= maxBytes;
  }

  const contentLength = parseContentLength(response.headers);
  if (contentLength !== null && contentLength > maxBytes) {
    return false;
  }

  const bodyWithinLimit = await readBodyWithinLimit(response, maxBytes);
  return bodyWithinLimit === true;
}

async function isGifUrlAllowed(
  url,
  {
    fetchImpl = globalThis.fetch,
    maxBytes = MAX_GIF_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cache = true,
  } = {},
) {
  const normalizedUrl = normalizeGifUrl(url);
  if (!normalizedUrl || typeof fetchImpl !== "function") {
    return false;
  }

  const cacheKey = `${maxBytes}:${normalizedUrl}`;
  if (cache && fetchImpl === globalThis.fetch && allowedCache.has(cacheKey)) {
    return allowedCache.get(cacheKey);
  }

  let allowed = false;

  try {
    const headResponse = await fetchWithTimeout(fetchImpl, normalizedUrl, { method: "HEAD" }, timeoutMs);
    if (headResponse?.ok) {
      const contentLength = parseContentLength(headResponse.headers);
      if (contentLength !== null) {
        allowed = contentLength <= maxBytes;
      } else {
        allowed = await probeWithGet(normalizedUrl, { fetchImpl, maxBytes, timeoutMs });
      }
    } else {
      allowed = await probeWithGet(normalizedUrl, { fetchImpl, maxBytes, timeoutMs });
    }
  } catch (_error) {
    try {
      allowed = await probeWithGet(normalizedUrl, { fetchImpl, maxBytes, timeoutMs });
    } catch (_fallbackError) {
      allowed = false;
    }
  }

  if (cache && fetchImpl === globalThis.fetch) {
    allowedCache.set(cacheKey, allowed);
  }

  return allowed;
}

async function getAllowedGifUrl(url, options = {}) {
  const normalizedUrl = normalizeGifUrl(url);
  if (!normalizedUrl) {
    return "";
  }

  return (await isGifUrlAllowed(normalizedUrl, options)) ? normalizedUrl : "";
}

async function getAllowedGifCandidates(candidates = [], options = {}) {
  const allowed = [];

  for (const candidate of candidates) {
    const url = typeof candidate === "string" ? candidate : candidate?.url;
    const allowedUrl = await getAllowedGifUrl(url, options);
    if (allowedUrl) {
      allowed.push(typeof candidate === "string" ? { url: allowedUrl } : { ...candidate, url: allowedUrl });
    }
  }

  return allowed;
}

module.exports = {
  MAX_GIF_BYTES,
  getAllowedGifCandidates,
  getAllowedGifUrl,
  isGifUrlAllowed,
};
