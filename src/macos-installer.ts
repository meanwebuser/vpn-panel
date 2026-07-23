import { MACOS_CONFIG_TOKEN } from "./macos-token.js";

export function bezMacInstallerScript(publicBaseUrl: string): string {
  const script = String.raw`#!/bin/bash
set -euo pipefail

# Rootless MVP: Xray listens on localhost and macOS network services use its
# HTTP/SOCKS proxy. A transparent TUN would require administrator privileges.
BASE_URL="__BEZ_BASE_URL__"
CONFIG_TOKEN="__BEZ_CONFIG_TOKEN__"
BOOTSTRAP_URL="https://github.com/megamen32/bez/releases/latest/download/bez"
PROFILE="vpn2-07"
CLI_DIR="$HOME/.local/bin"
CLI_PATH="$HOME/.local/bin/bez"
APP_DIR="$HOME/Library/Application Support/BezVPN"
XRAY_BIN="$APP_DIR/bin/xray"
CONFIG_PATH="$APP_DIR/config.json"
BUNDLE_MARKER="$APP_DIR/bundle-offline"
STATE_PATH="$APP_DIR/state"
PROXY_STATE="$APP_DIR/proxy-state"
PORT_STATE="$APP_DIR/ports"
PLIST_PATH="$HOME/Library/LaunchAgents/com.example.bez.plist"
LABEL="com.example.bez"
LAUNCH_DOMAIN="gui/$(id -u)"
LOG_PATH="$HOME/Library/Logs/BezVPN.log"
XRAY_VERSION="26.5.9"
SOCKS_PORT=10808
HTTP_PORT=10809
CODEX_INSTALL_DIR="$HOME/.local/bin"

die() { echo "bez: $*" >&2; exit 1; }
need_macos() { [[ "$(uname -s)" == Darwin ]] || die "macOS only"; }
installed() { [[ -x "$XRAY_BIN" && -f "$CONFIG_PATH" && -f "$PLIST_PATH" ]]; }
state_mode() {
  local mode="smart"
  if [[ -r "$STATE_PATH" ]]; then
    mode="$(sed -n 's/^mode=//p' "$STATE_PATH" | head -n 1)"
  fi
  [[ "$mode" == smart || "$mode" == all ]] || mode=smart
  printf '%s\n' "$mode"
}
read_ports() {
  [[ -r "$PORT_STATE" ]] || return 1
  local socks http
  socks="$(sed -n 's/^socks=//p' "$PORT_STATE" | head -n 1)"
  http="$(sed -n 's/^http=//p' "$PORT_STATE" | head -n 1)"
  [[ "$socks" =~ ^[0-9]+$ && "$http" =~ ^[0-9]+$ ]] || return 1
  SOCKS_PORT="$socks"
  HTTP_PORT="$http"
}
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
bundle_mode() { [[ -f "$BUNDLE_MARKER" ]]; }
temp_json() {
  local path
  path="$(mktemp "$APP_DIR/$1.XXXXXX")"
  mv "$path" "$path.json"
  printf '%s\n' "$path.json"
}
choose_ports() {
  local base=10808
  while port_busy "$base" || port_busy "$((base + 1))"; do
    [[ "$base" == 10808 ]] && base=11808 || base=$((base + 2))
    [[ "$base" -lt 20000 ]] || die "no free local proxy ports found"
  done
  SOCKS_PORT="$base"
  HTTP_PORT="$((base + 1))"
  printf 'socks=%s\nhttp=%s\n' "$SOCKS_PORT" "$HTTP_PORT" > "$PORT_STATE"
  chmod 600 "$PORT_STATE"
  echo "bez: using local proxy ports SOCKS=$SOCKS_PORT HTTP=$HTTP_PORT"
}
ensure_ports() {
  if read_ports && loaded; then return 0; fi
  if read_ports && ! port_busy "$SOCKS_PORT" && ! port_busy "$HTTP_PORT"; then return 0; fi
  choose_ports
}
install_cli() {
  mkdir -p "$CLI_DIR" || die "cannot create $CLI_DIR"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL "$BOOTSTRAP_URL" -o "$tmp" || die "cannot download bez from GitHub"
  chmod 700 "$tmp"
  mv "$tmp" "$CLI_PATH" || die "cannot install $CLI_PATH"
  case ":$PATH:" in *":$CLI_DIR:"*) ;; *) printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zprofile" ;; esac
  echo "bez installed at $CLI_PATH"
  echo "No administrator password is required. Run: bez install"
}
download_xray() {
  local asset tmp expected actual
  case "$(uname -m)" in
    arm64) asset=Xray-macos-arm64-v8a.zip ;;
    x86_64) asset=Xray-macos-64.zip ;;
    *) die "unsupported macOS architecture" ;;
  esac
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/v$XRAY_VERSION/$asset" -o "$tmp/xray.zip" || die "cannot download official Xray"
  curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/v$XRAY_VERSION/$asset.dgst" -o "$tmp/xray.dgst" || die "cannot download Xray checksum"
  expected="$(grep -Eio '[0-9a-f]{64}' "$tmp/xray.dgst" | head -n 1)"
  actual="$(shasum -a 256 "$tmp/xray.zip" | awk '{print $1}')"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ && "$actual" == "$expected" ]] || die "Xray SHA-256 verification failed"
  unzip -q "$tmp/xray.zip" -d "$tmp/unpacked"
  [[ -x "$tmp/unpacked/xray" ]] || die "Xray archive has no executable"
  mkdir -p "$APP_DIR/bin"
  install -m 755 "$tmp/unpacked/xray" "$XRAY_BIN"
  rm -rf "$tmp"
}
fetch_config() {
  local mode="$1" auth_file response
  mkdir -p "$APP_DIR"
  ensure_ports
  auth_file="$(mktemp)"
  response="$(temp_json .config)"
  chmod 600 "$auth_file" "$response"
  printf 'header = "Authorization: Bearer %s"\n' "$CONFIG_TOKEN" > "$auth_file"
  curl --config "$auth_file" -fsSL -H "accept: application/json" "$BASE_URL/api/user/macos-xray-config?mode=$mode" -o "$response" || die "cannot download $mode config"
  python3 - "$response" "$SOCKS_PORT" "$HTTP_PORT" <<'PY'
import json
import sys

path, socks_port, http_port = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
with open(path, encoding="utf-8") as stream:
    config = json.load(stream)
for inbound in config.get("inbounds", []):
    if inbound.get("protocol") == "socks":
        inbound["port"] = socks_port
    elif inbound.get("protocol") == "http":
        inbound["port"] = http_port
with open(path, "w", encoding="utf-8") as stream:
    json.dump(config, stream, separators=(",", ":"))
    stream.write("\n")
PY
  "$XRAY_BIN" run -test -config "$response" >/dev/null || die "Xray rejected the downloaded config"
  chmod 600 "$response"
  mv "$response" "$CONFIG_PATH" || die "cannot atomically install config"
  rm -f "$auth_file"
}
prepare_bundled_config() {
  local mode="$1" source response
  source="$APP_DIR/config-$mode.json"
  [[ -f "$source" ]] || source="$CONFIG_PATH"
  [[ -f "$source" ]] || die "bundled config is missing"
  mkdir -p "$APP_DIR"
  ensure_ports
  response="$(temp_json .bundled-config)"
  chmod 600 "$response"
  python3 - "$source" "$response" "$SOCKS_PORT" "$HTTP_PORT" <<'PY'
import json
import sys

source, target, socks_port, http_port = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with open(source, encoding="utf-8") as stream:
    config = json.load(stream)
for inbound in config.get("inbounds", []):
    if inbound.get("protocol") == "socks":
        inbound["port"] = socks_port
    elif inbound.get("protocol") == "http":
        inbound["port"] = http_port
with open(target, "w", encoding="utf-8") as stream:
    json.dump(config, stream, separators=(",", ":"))
    stream.write("\n")
PY
  "$XRAY_BIN" run -test -config "$response" >/dev/null || die "Xray rejected the bundled config"
  mv "$response" "$CONFIG_PATH" || die "cannot atomically install bundled config"
}
write_plist() {
  mkdir -p "$(dirname "$PLIST_PATH")" "$HOME/Library/Logs"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$XRAY_BIN</string><string>run</string><string>-config</string><string>$CONFIG_PATH</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$LOG_PATH</string><key>StandardErrorPath</key><string>$LOG_PATH</string>
</dict></plist>
PLIST
  mv "$tmp" "$PLIST_PATH"
  chmod 600 "$PLIST_PATH"
}
loaded() { launchctl print "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1; }
start_daemon() {
  if loaded; then
    launchctl kickstart -k "$LAUNCH_DOMAIN/$LABEL"
  else
    launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH"
  fi
}
restart_daemon() {
  if loaded; then
    launchctl bootout "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do loaded || break; sleep 0.25; done
  fi
  start_daemon
}
network_services() {
  networksetup -listallnetworkservices | awk 'NR > 1 && $0 !~ /^\*/ && length($0) { print }'
}
proxy_enabled() {
  networksetup "$1" "$2" 2>/dev/null | awk -F': ' '$1 == "Enabled" { print $2; exit }'
}
snapshot_proxies() {
  [[ -e "$PROXY_STATE" ]] && return 0
  mkdir -p "$APP_DIR"
  : > "$PROXY_STATE"
  local service web secure socks
  while IFS= read -r service; do
    web="$(proxy_enabled -getwebproxy "$service")"
    secure="$(proxy_enabled -getsecurewebproxy "$service")"
    socks="$(proxy_enabled -getsocksfirewallproxy "$service")"
    printf '%s\t%s\t%s\t%s\n' "$service" "$web" "$secure" "$socks" >> "$PROXY_STATE"
  done < <(network_services)
  chmod 600 "$PROXY_STATE"
}
apply_proxies() {
  snapshot_proxies
  local service failed=0
  while IFS= read -r service; do
    networksetup -setwebproxy "$service" 127.0.0.1 "$HTTP_PORT" || failed=1
    networksetup -setsecurewebproxy "$service" 127.0.0.1 "$HTTP_PORT" || failed=1
    networksetup -setsocksfirewallproxy "$service" 127.0.0.1 "$SOCKS_PORT" || failed=1
    networksetup -setwebproxystate "$service" on || failed=1
    networksetup -setsecurewebproxystate "$service" on || failed=1
    networksetup -setsocksfirewallproxystate "$service" on || failed=1
  done < <(network_services)
  if (( failed )); then
    echo "bez: some macOS services rejected proxy settings" >&2
    echo "bez: manual: networksetup -setwebproxy <service> 127.0.0.1 $HTTP_PORT" >&2
    return 1
  fi
}
restore_proxies() {
  [[ -r "$PROXY_STATE" ]] || return 0
  local service web secure socks web_state secure_state socks_state
  while IFS=$'\t' read -r service web secure socks; do
    [[ -n "$service" ]] || continue
    case "$web" in Yes|yes|on|On) web_state=on ;; *) web_state=off ;; esac
    case "$secure" in Yes|yes|on|On) secure_state=on ;; *) secure_state=off ;; esac
    case "$socks" in Yes|yes|on|On) socks_state=on ;; *) socks_state=off ;; esac
    networksetup -setwebproxystate "$service" "$web_state" >/dev/null 2>&1 || true
    networksetup -setsecurewebproxystate "$service" "$secure_state" >/dev/null 2>&1 || true
    networksetup -setsocksfirewallproxystate "$service" "$socks_state" >/dev/null 2>&1 || true
  done < "$PROXY_STATE"
  rm -f "$PROXY_STATE"
}
wait_proxy() {
  for _ in $(seq 1 20); do
    if nc -z 127.0.0.1 "$SOCKS_PORT" >/dev/null 2>&1 && nc -z 127.0.0.1 "$HTTP_PORT" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  echo "bez: Xray did not open local proxy ports; see bez logs" >&2
  return 1
}
activate() {
  local mode="$1" offline="" system_proxy=1 option
  shift
  while [[ $# -gt 0 ]]; do
    option="$1"
    case "$option" in
      --offline) offline=--offline ;;
      --local|--no-system-proxy) system_proxy=0 ;;
      *) die "unknown activation option: $option" ;;
    esac
    shift
  done
  if bundle_mode; then
    offline=--offline
    system_proxy=0
  fi
  installed || die "run bez install first"
  case "$offline" in
    "") fetch_config "$mode" ;;
    --offline) prepare_bundled_config "$mode" ;;
    *) die "unknown activation option: $offline" ;;
  esac
  printf 'mode=%s\n' "$mode" > "$STATE_PATH"
  restart_daemon
  wait_proxy
  if (( system_proxy )); then
    apply_proxies
    echo "bez: $mode enabled (macOS system proxy, no root)"
  else
    echo "bez: $mode enabled (local proxy only; macOS system settings unchanged)"
    echo "bez: run: eval \"\$(bez proxy)\""
  fi
}
install_bez() {
  need_macos
  if bundle_mode; then
    prepare_bundled_config smart
    write_plist
    printf 'mode=smart\n' > "$STATE_PATH"
    start_daemon
    wait_proxy
    echo "bez: bundled smart mode enabled (local proxy only; no network or root required)"
    return 0
  fi
  echo "bez: passwordless rootless mode; no sudo or VPN password is required"
  echo "bez: Xray will run as your user and macOS proxy settings will be changed for your user"
  mkdir -p "$APP_DIR"
  download_xray
  fetch_config smart
  write_plist
  printf 'mode=smart\n' > "$STATE_PATH"
  start_daemon
  wait_proxy
  apply_proxies
  echo "bez: installed and smart mode enabled"
}
update_bez() {
  need_macos
  installed || die "run bez install first"
  local mode
  mode="$(state_mode)"
  fetch_config "$mode"
  restart_daemon
  wait_proxy
  if ! bundle_mode; then apply_proxies; fi
  echo "bez: $mode config updated"
}
off_bez() {
  need_macos
  if loaded; then launchctl bootout "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1 || true; fi
  restore_proxies
  echo "bez: off; previous macOS proxy settings restored"
}
status_bez() {
  need_macos
  read_ports || true
  loaded && echo "bez: running" || echo "bez: off"
  echo "mode: $(state_mode)"
  echo "xray: $XRAY_BIN"
  echo "socks: 127.0.0.1:$SOCKS_PORT"
  echo "http: 127.0.0.1:$HTTP_PORT"
  echo "system proxy state: $([[ -e "$PROXY_STATE" ]] && echo managed || echo not-managed)"
  echo "note: use 'bez smart --local' to keep macOS system proxy settings unchanged"
}
logs_bez() { [[ -f "$LOG_PATH" ]] && tail -n 100 "$LOG_PATH" || echo "bez: no log yet"; }
proxy_bez() {
  ensure_ports
  echo "export http_proxy=http://127.0.0.1:$HTTP_PORT"
  echo "export https_proxy=http://127.0.0.1:$HTTP_PORT"
  echo "export all_proxy=socks5h://127.0.0.1:$SOCKS_PORT"
  echo "export HTTP_PROXY=http://127.0.0.1:$HTTP_PORT"
  echo "export HTTPS_PROXY=http://127.0.0.1:$HTTP_PORT"
  echo "export ALL_PROXY=socks5h://127.0.0.1:$SOCKS_PORT"
}
codex_binary() {
  if [[ -x "$CODEX_INSTALL_DIR/codex" ]]; then
    printf '%s\n' "$CODEX_INSTALL_DIR/codex"
  else
    command -v codex || true
  fi
}
install_codex() {
  command -v curl >/dev/null 2>&1 || die "curl is required to install Codex"
  echo "bez: Codex is not installed; installing it for this user without root"
  HTTP_PROXY="http://127.0.0.1:$HTTP_PORT" \
  HTTPS_PROXY="http://127.0.0.1:$HTTP_PORT" \
  ALL_PROXY="socks5h://127.0.0.1:$SOCKS_PORT" \
  CODEX_NON_INTERACTIVE=1 CODEX_INSTALL_DIR="$CODEX_INSTALL_DIR" \
    sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' || die "Codex installation failed"
}
codex_bez() {
  need_macos
      if ! installed; then
        install_bez
      elif ! loaded; then
        if bundle_mode; then
          activate "$(state_mode)" --offline --local
        else
          activate "$(state_mode)"
        fi
      fi
  ensure_ports
  local codex_bin
  codex_bin="$(codex_binary)"
  if [[ -z "$codex_bin" ]]; then
    install_codex
    codex_bin="$CODEX_INSTALL_DIR/codex"
  fi
  [[ -x "$codex_bin" ]] || die "Codex executable was not found after installation"
  http_proxy="http://127.0.0.1:$HTTP_PORT" \
  https_proxy="http://127.0.0.1:$HTTP_PORT" \
  all_proxy="socks5h://127.0.0.1:$SOCKS_PORT" \
  HTTP_PROXY="http://127.0.0.1:$HTTP_PORT" \
  HTTPS_PROXY="http://127.0.0.1:$HTTP_PORT" \
  ALL_PROXY="socks5h://127.0.0.1:$SOCKS_PORT" \
    "$codex_bin" "$@"
}
unproxy_bez() { echo 'unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY'; }
interactive_bez() {
  need_macos
  [[ -t 0 ]] || die "bez without a command requires an interactive terminal"
  cat <<'MENU'
Bez — выбери действие:
  1) smart — системный proxy macOS
  2) all   — системный proxy macOS
  3) smart — только локальный proxy, настройки macOS не менять
  4) all   — только локальный proxy, настройки macOS не менять
  5) off   — выключить
  q) выход
MENU
  printf 'Выбор: '
  local choice
  IFS= read -r choice
  case "$choice" in
    1) activate smart ;;
    2) activate all ;;
    3) activate smart --local ;;
    4) activate all --local ;;
    5) off_bez ;;
    q|Q|'') ;;
    *) die "неизвестный выбор: $choice" ;;
  esac
}

if [[ $# -eq 0 && "$0" != "$CLI_PATH" ]]; then install_cli; exit 0; fi
need_macos
if [[ $# -eq 0 ]]; then interactive_bez; exit 0; fi
command=help
[[ $# -gt 0 ]] && command="$1"
case "$command" in
  install) install_bez ;;
  smart|all)
    shift
    activate "$command" "$@"
    ;;
  update) update_bez ;;
  off) off_bez ;;
  status) status_bez ;;
  logs) logs_bez ;;
  proxy) proxy_bez ;;
  unproxy) unproxy_bez ;;
  codex) shift; codex_bez "$@" ;;
  *) echo "usage: bez [interactive]|install|smart|all|update|off|status|logs|proxy|unproxy|codex" ;;
esac
`;
  const baseUrl = JSON.stringify(publicBaseUrl.replace(/\/+$/, ""));
  const configToken = JSON.stringify(MACOS_CONFIG_TOKEN);
  return script
    .replace('BASE_URL="__BEZ_BASE_URL__"', "BASE_URL=" + baseUrl)
    .replace('CONFIG_TOKEN="__BEZ_CONFIG_TOKEN__"', "CONFIG_TOKEN=" + configToken) + "\n";
}

function requireHttpsBaseUrl(publicBaseUrl: string): URL {
  const baseUrl = new URL(publicBaseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("macOS installer requires an HTTPS public base URL");
  return baseUrl;
}

/** @deprecated Legacy per-user sing-box command; new clients should use /install/bez. */
export function macosInstallerCommand(publicBaseUrl: string, token: string): string {
  const installerUrl = new URL("/install/macos.sh", requireHttpsBaseUrl(publicBaseUrl));
  installerUrl.searchParams.set("token", token);
  return `curl -fsSL '${installerUrl.toString()}' | zsh`;
}

/** @deprecated Kept for existing Masha links while /install/bez is the supported Xray bootstrap. */
export function macosInstallerScript(publicBaseUrl: string, token: string): string {
  const installerUrl = new URL("/api/user/macos-config", requireHttpsBaseUrl(publicBaseUrl));
  installerUrl.searchParams.set("token", token);
  const configUrl = JSON.stringify(installerUrl.toString());
  return `#!/usr/bin/env sh
set -eu
umask 077

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi
if ! command -v sing-box >/dev/null 2>&1; then
  echo "Install sing-box first (for example: brew install sing-box)." >&2
  exit 1
fi

CONFIG_DIR="$HOME/.config/sing-box"
CONFIG_PATH="$CONFIG_DIR/config.json"
PLIST_PATH="$HOME/Library/LaunchAgents/com.example.macos-sing-box.plist"
LABEL="com.example.macos-sing-box"
TMP_CONFIG="$(mktemp "\${TMPDIR:-/tmp}/bezvpn-macos.XXXXXX.json")"
trap 'rm -f "$TMP_CONFIG"' EXIT
curl -fsSL --retry 3 ${configUrl} -o "$TMP_CONFIG"
sing-box check -c "$TMP_CONFIG"
mkdir -p "$CONFIG_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 600 "$TMP_CONFIG" "$CONFIG_PATH"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(command -v sing-box)</string><string>run</string><string>-c</string><string>$CONFIG_PATH</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/bezvpn-macos-sing-box.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/bezvpn-macos-sing-box.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "Legacy sing-box profile installed; use /install/bez for the rootless Xray client."
`;
}
