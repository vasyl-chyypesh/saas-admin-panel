import { useEffect, useState } from 'react';

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response (network failure). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const fetchJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, ...(signal && { signal }) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'Could not reach the server');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as
      { message?: unknown; error?: unknown } | undefined;
    const message =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : res.statusText;
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
};

export interface FetchState<T> {
  /** Last successful payload. Kept while a new URL loads so lists don't flash empty. */
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
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
        const error = err instanceof ApiError ? err : new ApiError(0, 'Unexpected error');
        setSettled({ url, data: undefined, error });
      },
    );

    return () => {
      controller.abort();
    };
  }, [url]);

  const current = settled.url === url;
  return {
    data: settled.data,
    // A stale error belongs to a URL we've moved away from; don't show it while the new one loads.
    error: current ? settled.error : undefined,
    loading: !current,
  };
};
