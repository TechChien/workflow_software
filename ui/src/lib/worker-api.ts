import { workerApiBaseUrl } from "./env";

export async function workerApi<TResponse>(
  path: string,
  init?: RequestInit
): Promise<TResponse> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${workerApiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(`Worker API failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TResponse>;
}
