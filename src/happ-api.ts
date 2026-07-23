import type { SecureConfig } from "./secure-config.js";

export type HappInstall = {
  id: number;
  install_code: string;
  install_limit: number;
  install_count: number;
  status: number;
  note: string | null;
  created_at: string;
};

export type HappHwid = {
  hwid: string;
  date: string;
  device_name: string;
};

async function happGet<T>(secure: SecureConfig, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, secure.happ.base_url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  return (await response.json()) as T;
}

async function happPost<T>(secure: SecureConfig, path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(path, secure.happ.base_url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const init: RequestInit = {
    method: "POST",
    headers: { accept: "application/json" },
  };
  if (body) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url.toString(), init);
  return (await response.json()) as T;
}

function authParams(secure: SecureConfig): Record<string, string> {
  return {
    provider_code: secure.happ.provider_code,
    auth_key: secure.happ.auth_key,
  };
}

export async function happAddInstall(
  secure: SecureConfig,
  options: { installCode?: string; installLimit?: number; note?: string },
): Promise<{ rc: number; msg: string; install_code?: string; id?: number }> {
  const params: Record<string, string> = {
    ...authParams(secure),
    install_limit: String(options.installLimit ?? 10),
  };
  if (options.installCode) params.install_code = options.installCode;
  if (options.note) params.note = options.note;
  return happGet(secure, "/api/add-install", params);
}

export async function happUpdateInstall(
  secure: SecureConfig,
  options: { id: number; installLimit?: number; status?: number; note?: string },
): Promise<{ rc: number; msg: string; install_code?: string; id?: number }> {
  const params: Record<string, string> = {
    ...authParams(secure),
    id: String(options.id),
  };
  if (options.installLimit !== undefined) params.install_limit = String(options.installLimit);
  if (options.status !== undefined) params.status = String(options.status);
  if (options.note !== undefined) params.note = options.note;
  return happGet(secure, "/api/update-install", params);
}

export async function happListInstalls(
  secure: SecureConfig,
  id?: number,
): Promise<{ rc: number; msg: string; data?: HappInstall[] }> {
  const params: Record<string, string> = { ...authParams(secure) };
  if (id !== undefined) params.id = String(id);
  return happGet(secure, "/api/list-install", params);
}

export async function happListHwids(
  secure: SecureConfig,
  options: { installCode?: string; installId?: number; hwid?: string },
): Promise<{ rc: number; msg: string; data?: HappHwid[] }> {
  const params: Record<string, string> = { ...authParams(secure) };
  if (options.installCode) params.install_code = options.installCode;
  if (options.installId !== undefined) params.install_id = String(options.installId);
  if (options.hwid) params.hwid = options.hwid;
  return happGet(secure, "/api/list-hwid", params);
}

export async function happDeleteHwid(
  secure: SecureConfig,
  options: { installCode: string; hwid: string },
): Promise<{ rc: number; msg: string; install_count?: number }> {
  const params: Record<string, string> = {
    ...authParams(secure),
    install_code: options.installCode,
    hwid: options.hwid,
  };
  return happGet(secure, "/api/delete-hwid", params);
}

export async function happSendCommand(
  secure: SecureConfig,
  body: {
    action_type: string;
    specific_device_toggle: boolean;
    hwid?: string;
    os?: string[];
    import_data?: string;
    settings?: Record<string, unknown>;
    change_type?: string;
    change_value?: string;
  },
): Promise<{ rc: number; msg: string; id?: number }> {
  return happPost(secure, "/remote/command", authParams(secure), body);
}

export async function happSendNotification(
  secure: SecureConfig,
  body: {
    PushNotificationForm: {
      title?: string;
      body: string;
      type_push: "force" | "optional";
      expire_days: number;
      link_for_open?: string;
      send_date?: string;
      send_time?: string;
      locales?: Record<string, Record<string, string>>;
    };
    hwid?: string;
    os?: string[];
  },
): Promise<{ rc: number; msg: string; id?: number }> {
  return happPost(secure, "/remote/notification", authParams(secure), body);
}

export function happInstallDeeplink(secure: SecureConfig, installCode: string): string {
  return `happ://install/${secure.happ.provider_code}/${installCode}`;
}
