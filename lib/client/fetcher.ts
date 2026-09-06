"use client";

export class ApiError extends Error {
  status: number;
  retryAfterSec?: number;
  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiSend<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

async function toError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  let retryAfterSec: number | undefined;
  try {
    const data = (await res.json()) as { error?: string; retryAfterSec?: number };
    if (data.error) message = data.error;
    retryAfterSec = data.retryAfterSec;
  } catch {
    // ignore
  }
  return new ApiError(res.status, message, retryAfterSec);
}
