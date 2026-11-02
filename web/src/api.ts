let renewing: Promise<boolean> | null = null;

export function renewAccess() {
  renewing ??= fetch("/api/access", { method: "POST" })
    .then((response) => response.ok)
    .finally(() => {
      renewing = null;
    });

  return renewing;
}

export async function apiFetch(path: string, options?: RequestInit) {
  const response = await fetch(path, options);

  if (response.status !== 401) {
    return response;
  }

  if (!(await renewAccess())) {
    return response;
  }

  return fetch(path, options);
}

export async function request(
  path: string,
  body: unknown = {},
  method = "POST",
) {
  const response = await apiFetch(`/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error);
  }

  return result;
}
