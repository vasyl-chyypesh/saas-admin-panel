import { useCallback, useEffect, useMemo, useState } from 'react';

/** Per-field messages from a 400/409 body (`details`), keyed by the request field name. */
export type FieldErrors = Partial<Record<string, string[]>>;

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response (network failure). */
  readonly status: number;
  readonly details: FieldErrors;

  constructor(status: number, message: string, details: FieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Normalises anything a request can throw, so callers only deal with `ApiError`. */
export const toApiError = (err: unknown): ApiError =>
  err instanceof ApiError ? err : new ApiError(0, 'Unexpected error');

const isFieldErrors = (value: unknown): value is FieldErrors =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every(
    (messages) =>
      messages === undefined ||
      (Array.isArray(messages) && messages.every((m) => typeof m === 'string')),
  );

const errorFromResponse = async (res: Response): Promise<ApiError> => {
  const body = (await res.json().catch(() => undefined)) as
    { message?: unknown; error?: unknown; details?: unknown } | undefined;
  const message =
    typeof body?.message === 'string'
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : res.statusText;
  return new ApiError(res.status, message, isFieldErrors(body?.details) ? body.details : {});
};

const request = async <T>(url: string, init: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError(0, 'Could not reach the server');
  }

  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
};

export const fetchJson = <T>(url: string, signal?: AbortSignal): Promise<T> =>
  request<T>(url, { headers: { Accept: 'application/json' }, ...(signal && { signal }) });

/** Sends `body` as JSON and returns the parsed response; failures throw `ApiError`. */
export const sendJson = <T>(
  method: 'POST' | 'PATCH',
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> =>
  request<T>(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/**
 * A v4 UUID for the `Idempotency-Key` header. `crypto.randomUUID` exists only in secure contexts
 * (https or localhost), so plain-HTTP access over a LAN falls back to `getRandomValues`, which is
 * available everywhere.
 */
export const newIdempotencyKey = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export interface FetchState<T> {
  /** Last successful payload. Kept while a new URL loads so lists don't flash empty. */
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /**
   * Replaces the data for the current URL without refetching, e.g. with the body a PATCH returned.
   * Ignored if the URL has changed since, so a late write can't clobber the new URL's result.
   */
  mutate: (data: T) => void;
  /** Fetches the current URL again, keeping the shown data until the new result arrives. */
  reload: () => void;
}

interface Settled<T> {
  /** The URL this result belongs to; `loading` is derived by comparing it with the current one. */
  url: string | undefined;
  data: T | undefined;
  error: ApiError | undefined;
}

/** GETs `url` and refetches when it changes; superseded requests are aborted. */
export const useFetchJson = <T>(url: string): FetchState<T> => {
  const [settled, setSettled] = useState<Settled<T>>({
    url: undefined,
    data: undefined,
    error: undefined,
  });
  /** Bumped by `reload`, giving a new `fetchKey` object for the same URL, so the effect re-runs. */
  const [generation, setGeneration] = useState(0);
  const fetchKey = useMemo(() => ({ url, generation }), [url, generation]);

  useEffect(() => {
    const controller = new AbortController();
    const requestUrl = fetchKey.url;

    fetchJson<T>(requestUrl, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ url: requestUrl, data, error: undefined });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ url: requestUrl, data: undefined, error: toApiError(err) });
      },
    );

    return () => {
      controller.abort();
    };
  }, [fetchKey]);

  const reload = useCallback(() => {
    setGeneration((n) => n + 1);
  }, []);

  const mutate = useCallback(
    (data: T) => {
      setSettled((prev) => (prev.url === url ? { url, data, error: undefined } : prev));
    },
    [url],
  );

  const current = settled.url === url;
  return {
    data: settled.data,
    // A stale error belongs to a URL we've moved away from; don't show it while the new one loads.
    error: current ? settled.error : undefined,
    loading: !current,
    mutate,
    reload,
  };
};
