#!/usr/bin/env bash
# Cursor の履歴・キャッシュを一括削除（設定・拡張は残す）
#
# 重要: Cursor を完全終了（トレイ含む）してから実行すること。
# 起動中だと Cache 等がロックされ消し残る。
#
#   FORCE=1 bash ~/RetroCpuEmu/scripts/wipe-cursor-history-cache.sh
set +e
set -u

FORCE="${FORCE:-0}"
WIN_ROAMING="/mnt/c/Users/satot/AppData/Roaming/Cursor"
WIN_LOCAL="/mnt/c/Users/satot/AppData/Local/Cursor"
WSL_CURSOR="${HOME}/.cursor"
WSL_SERVER="${HOME}/.cursor-server"
BACKUP="${HOME}/.cursor/wipe-backup-$(date +%Y%m%d%H%M%S)"
FAILED=0

if pgrep -ai '[Cc]ursor' >/dev/null 2>&1; then
  echo "警告: Cursor プロセスが見つかりました。ロックで消し残る可能性が高いです。"
  if [ "${FORCE}" != "1" ]; then
    read -r -p "続行しますか? [y/N] " ans || true
    case "${ans:-}" in y|Y) ;; *) exit 1 ;; esac
  fi
fi

mkdir -p "${BACKUP}"
echo "バックアップ先（設定のみ）: ${BACKUP}"

for f in \
  "${WIN_ROAMING}/User/settings.json" \
  "${WIN_ROAMING}/User/keybindings.json" \
  "${WIN_ROAMING}/User/tasks.json" \
  "${HOME}/.cursor/ide_state.json"
do
  [ -e "${f}" ] || continue
  cp -a "${f}" "${BACKUP}/" 2>/dev/null || true
done
[ -d "${WIN_ROAMING}/User/snippets" ] && cp -a "${WIN_ROAMING}/User/snippets" "${BACKUP}/" 2>/dev/null || true

wipe() {
  local p="$1"
  [ -e "${p}" ] || [ -L "${p}" ] || return 0
  echo "wipe ${p}"
  chmod -R u+w "${p}" 2>/dev/null
  rm -rf "${p}" 2>/dev/null
  if [ -e "${p}" ]; then
    local win
    win=$(wslpath -w "${p}" 2>/dev/null || true)
    if [ -n "${win}" ]; then
      powershell.exe -NoProfile -Command \
        "Remove-Item -LiteralPath '${win}' -Recurse -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
    fi
  fi
  if [ -e "${p}" ]; then
    echo "  FAIL (locked?): ${p}"
    FAILED=1
  else
    echo "  OK"
  fi
}

if [ -d "${WIN_ROAMING}" ]; then
  for name in \
    Cache CachedData CachedExtensions CachedExtensionVSIXs CachedConfigurations CachedProfilesData \
    "Code Cache" GPUCache DawnGraphiteCache DawnWebGPUCache \
    logs blob_storage Crashpad snapshots \
    "Service Worker" "Session Storage" "Local Storage" IndexedDB WebStorage \
    Network Partitions SharedStorage SharedStorage-wal "Shared Dictionary" \
    process-monitor sentry clp DIPS DIPS-wal Backups
  do
    wipe "${WIN_ROAMING}/${name}"
  done

  wipe "${WIN_ROAMING}/User/workspaceStorage"
  wipe "${WIN_ROAMING}/User/History"
  wipe "${WIN_ROAMING}/User/globalStorage/state.vscdb"
  wipe "${WIN_ROAMING}/User/globalStorage/state.vscdb-shm"
  wipe "${WIN_ROAMING}/User/globalStorage/state.vscdb-wal"

  if [ -f "${WIN_ROAMING}/User/globalStorage/storage.json" ]; then
    cp -a "${WIN_ROAMING}/User/globalStorage/storage.json" "${BACKUP}/storage.json" || true
    python3 - "${WIN_ROAMING}/User/globalStorage/storage.json" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
try:
    data = json.loads(p.read_text(encoding="utf-8"))
except Exception as e:
    print("storage.json skip:", e)
    raise SystemExit(0)
pa = data.get("profileAssociations")
if isinstance(pa, dict):
    pa["workspaces"] = {}
    pa["emptyWindows"] = {}
for k in list(data.keys()):
    if k == "profileAssociations":
        continue
    lk = k.lower()
    if any(x in lk for x in ("backup", "recent", "opened", "window", "workspace", "lastactive", "splash")):
        if k.startswith("theme") or k.startswith("color"):
            continue
        data.pop(k, None)
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("storage.json cleaned")
PY
  fi
fi

if [ -d "${WIN_LOCAL}" ]; then
  echo "wipe Local/Cursor contents"
  find "${WIN_LOCAL}" -mindepth 1 -maxdepth 1 -print0 2>/dev/null \
    | while IFS= read -r -d '' p; do wipe "${p}"; done
fi

python3 - <<'PY'
from pathlib import Path
roots = [
    Path("/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations"),
    Path("/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/CustomDestinations"),
]
removed = 0
for root in roots:
    if not root.is_dir():
        continue
    for p in root.iterdir():
        if not p.is_file():
            continue
        try:
            data = p.read_bytes()
        except OSError:
            continue
        if b"Cursor" in data or b"RetroEmu" in data or b"RetroCpuEmu" in data or b"wsl" in data.lower():
            try:
                p.unlink()
                removed += 1
                print("jump-list", p.name)
            except OSError as e:
                print("jump-list fail", p, e)
print(f"jump-list removed: {removed}")
PY

find /mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent -maxdepth 1 -type f \
  \( -iname '*ursor*' -o -iname '*Retro*' -o -iname '*wsl*' \) -delete 2>/dev/null || true

if [ -d "${WSL_SERVER}" ]; then
  wipe "${WSL_SERVER}/data/CachedData"
  wipe "${WSL_SERVER}/data/logs"
  wipe "${WSL_SERVER}/data/snapshots"
  wipe "${WSL_SERVER}/data/User/workspaceStorage"
  wipe "${WSL_SERVER}/data/User/History"
  wipe "${WSL_SERVER}/data/User/globalStorage/state.vscdb"
  wipe "${WSL_SERVER}/data/User/globalStorage/state.vscdb-shm"
  wipe "${WSL_SERVER}/data/User/globalStorage/state.vscdb-wal"
  wipe "${WSL_SERVER}/data/Cache"
  wipe "${WSL_SERVER}/data/CachedExtensions"
fi

wipe "${WSL_CURSOR}/projects"
find "${WSL_CURSOR}" -maxdepth 1 -type d \( -name 'retroemu-cleanup-backup-*' -o -name 'wipe-backup-*' \) \
  ! -path "${BACKUP}" -exec rm -rf {} + 2>/dev/null || true

echo '{}' > "${WSL_CURSOR}/ide_state.json"

PLACEHOLDER_MSG=$'このパスは旧プロジェクト名です。実体は ~/RetroCpuEmu を使ってください。\n（ディレクトリ再作成防止用のプレースホルダファイル。削除しないでください）\n'
if [ -d "${HOME}/RetroEmu" ]; then
  if [ -z "$(find "${HOME}/RetroEmu" -type f 2>/dev/null | head -3)" ]; then
    rm -rf "${HOME}/RetroEmu"
  else
    echo "注意: ${HOME}/RetroEmu が中身付きディレクトリです"
  fi
fi
if [ ! -d "${HOME}/RetroEmu" ]; then
  chmod u+w "${HOME}/RetroEmu" 2>/dev/null || true
  printf '%s' "${PLACEHOLDER_MSG}" > "${HOME}/RetroEmu"
  chmod 444 "${HOME}/RetroEmu"
  echo "placeholder: ${HOME}/RetroEmu"
fi

echo
echo "バックアップ: ${BACKUP}"
if [ "${FAILED}" -ne 0 ]; then
  echo "一部削除失敗（Cursor がファイルロック中の可能性）。"
  echo "Cursor をトレイ含め完全終了してから、再実行してください:"
  echo "  FORCE=1 bash ~/RetroCpuEmu/scripts/wipe-cursor-history-cache.sh"
  exit 2
fi
echo "完了。Cursor を再起動し、~/RetroCpuEmu を開き直してください。"
