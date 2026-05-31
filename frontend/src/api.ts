import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "auth_token";

export async function setToken(t: string | null) {
  if (t) await storage.secureSet(TOKEN_KEY, t);
  else await storage.secureRemove(TOKEN_KEY);
}

export async function getToken(): Promise<string | null> {
  return storage.secureGet<string>(TOKEN_KEY, "");
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = await getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE_URL}/api${path}`, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg));
  }
  return data as T;
}

export const api = {
  // auth
  signup: (email: string, password: string, full_name?: string) =>
    request<{ access_token: string; user: any }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name }),
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<any>("/auth/me"),

  // sources
  listSources: () => request<{ sources: any[] }>("/sources"),
  connectGDrive: (access_token: string, account_label: string) =>
    request<any>("/sources/gdrive", {
      method: "POST",
      body: JSON.stringify({ access_token, account_label }),
    }),
  connectDropbox: (access_token: string, account_label: string) =>
    request<any>("/sources/dropbox", {
      method: "POST",
      body: JSON.stringify({ access_token, account_label }),
    }),
  disconnectSource: (id: string) =>
    request<any>(`/sources/${id}`, { method: "DELETE" }),

  // files
  listFiles: () => request<{ files: any[]; count: number }>("/files"),
  deleteFile: (id: string) => request<any>(`/files/${id}`, { method: "DELETE" }),
  renameFile: (id: string, new_name: string) =>
    request<any>(`/files/${id}/rename`, {
      method: "POST",
      body: JSON.stringify({ new_name }),
    }),

  // scan
  scanGDrive: (sourceId: string) =>
    request<any>(`/scan/gdrive/${sourceId}`, { method: "POST" }),
  scanDropbox: (sourceId: string) =>
    request<any>(`/scan/dropbox/${sourceId}`, { method: "POST" }),
  analyze: () => request<any>("/scan/analyze", { method: "POST" }),
  renameCandidates: () => request<any>("/scan/rename-candidates"),

  // dashboard
  stats: () => request<any>("/dashboard/stats"),

  // upload (multipart) — special handling
  uploadFile: async (fileUri: string, fileName: string, mimeType: string) => {
    const t = await getToken();
    const form = new FormData();
    // React Native FormData supports {uri, name, type}
    // @ts-expect-error native FormData accepts file object
    form.append("file", { uri: fileUri, name: fileName, type: mimeType });
    const res = await fetch(`${BASE_URL}/api/files/upload`, {
      method: "POST",
      headers: {
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      body: form,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok)
      throw new ApiError(
        res.status,
        (data && (data.detail || data.message)) || `Upload failed (${res.status})`,
      );
    return data;
  },
};
