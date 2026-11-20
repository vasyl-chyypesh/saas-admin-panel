import { useCallback, useEffect, useState } from 'react';

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
export const sendJson = <T>(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<T> =>
  request<T>(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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

  useEffect(() => {
    const controller = new AbortController();

    fetchJson<T>(url, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ url, data, error: undefined });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ url, data: undefined, error: toApiError(err) });
      },
    );

    return () => {
      controller.abort();
    };
  }, [url]);

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
  };
};
