export type AccountRole = "admin" | "user";

export type Account = {
  id: string;
  login: string;
  display_name: string;
  password_hash: string;
  role: AccountRole;
  enabled: boolean;
};

export type Endpoint = {
  id: string;
  label: string;
  kind: string;
  address: string;
  port: number;
  profile_id: string;
  enabled: boolean;
  sort_order: number;
  config: Record<string, unknown>;
};

export type ClientRecord = {
  id: string;
  account_id: string;
  xray_uuid: string;
  enabled: boolean;
};
