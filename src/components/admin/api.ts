"use client";

import { useCallback, useEffect, useState } from "react";

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function adminFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers:
        options.body instanceof FormData
          ? options.headers
          : { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError(
      "Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.",
      0,
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.location.replace("/admin/login");
    throw new AdminApiError(
      typeof data.error === "string"
        ? data.error
        : "Не удалось выполнить действие. Попробуйте ещё раз.",
      response.status,
      data.fieldErrors,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Что-то пошло не так. Попробуйте ещё раз.";
}

export function useAdminData<T>(path: string) {
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
    path: string;
  }>({
    data: null,
    error: "",
    loading: true,
    path,
  });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    adminFetch<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: "", loading: false, path }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error: errorMessage(error),
            loading: false,
            path,
          });
      });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, loading: state.loading || state.path !== path, reload };
}
