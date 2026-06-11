import { baseApi } from "./api/base-api";

export async function workerApi<TResponse>(
  path: string,
  init?: RequestInit
): Promise<TResponse> {
  return baseApi.request<TResponse>({
    url: path,
    method: init?.method ?? "GET",
    headers: normalizeHeaders(init?.headers),
    data: normalizeBody(init?.body)
  });
}

function normalizeHeaders(headers?: HeadersInit) {
  const normalized = new Headers(headers);
  const entries = Array.from(normalized.entries());
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeBody(body?: BodyInit | null): unknown {
  if (typeof body !== "string") {
    return body;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}
