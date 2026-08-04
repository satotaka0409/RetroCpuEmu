#!/usr/bin/env bash
# Cursor が古い ~/RetroEmu パスを触ってディレクトリを作り直すのを止める掃除スクリプト。
# 使い方:
#   1. Cursor を完全終了する（トレイアイコンも含む）
#   2. WSL で: bash ~/RetroCpuEmu/scripts/cleanup-retroemu-cursor-history.sh
#   3. Cursor を起動し、File > Open Recent から RetroEmu が消えていることを確認
set -euo pipefail

STAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR="${HOME}/.cursor/retroemu-cleanup-backup-${STAMP}"
mkdir -p "${BACKUP_DIR}"

STORAGE="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/storage.json"
STATE_DB="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
IDE_STATE="${HOME}/.cursor/ide_state.json"
WS_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/workspaceStorage"
CC_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/CachedConfigurations/workspaces"

if [ ! -f "${STORAGE}" ] || [ ! -f "${STATE_DB}" ]; then
  echo "Cursor User データが見つかりません: ${STORAGE}"
  exit 1
fi

# Cursor が開いていると state.vscdb 書き込みが失敗しやすい
if pgrep -ai '[Cc]ursor' >/dev/null 2>&1; then
  echo "警告: Cursor プロセスが動いているようです。完全終了してから再実行してください。"
  echo "続行すると state.vscdb の更新に失敗することがあります。"
  read -r -p "それでも続行しますか? [y/N] " ans || true
  case "${ans:-}" in
    y|Y) ;;
    *) exit 1 ;;
  esac
fi

cp -a "${STORAGE}" "${BACKUP_DIR}/storage.json"
cp -a "${STATE_DB}" "${BACKUP_DIR}/state.vscdb"
cp -a "${STATE_DB}-shm" "${BACKUP_DIR}/" 2>/dev/null || true
cp -a "${STATE_DB}-wal" "${BACKUP_DIR}/" 2>/dev/null || true
cp -a "${IDE_STATE}" "${BACKUP_DIR}/ide_state.json" 2>/dev/null || true
echo "バックアップ: ${BACKUP_DIR}"

python3 - "${STORAGE}" "${STATE_DB}" "${IDE_STATE}" <<'PY'
import json, sqlite3, sys
from pathlib import Path

storage_path, db_path, ide_path = map(Path, sys.argv[1:4])

# storage.json — profileAssociations
data = json.loads(storage_path.read_text(encoding="utf-8"))
pa = data.setdefault("profileAssociations", {})
ws = pa.get("workspaces", {})
if isinstance(ws, dict):
    before = len(ws)
    pa["workspaces"] = {k: v for k, v in ws.items() if "RetroEmu" not in k}
    print(f"profileAssociations.workspaces: {before} -> {len(pa['workspaces'])}")
storage_path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")

# ide_state.json
if ide_path.exists():
    ide = json.loads(ide_path.read_text(encoding="utf-8"))
    rv = ide.get("recentlyViewedFiles")
    if isinstance(rv, list):
        neo = [x for x in rv if "RetroEmu" not in json.dumps(x, ensure_ascii=False)]
        print(f"ide_state.recentlyViewedFiles: {len(rv)} -> {len(neo)}")
        ide["recentlyViewedFiles"] = neo
        ide_path.write_text(json.dumps(ide, ensure_ascii=False), encoding="utf-8")

def drop_retroemu(obj):
    if isinstance(obj, list):
        return [drop_retroemu(x) for x in obj if "RetroEmu" not in json.dumps(x, ensure_ascii=False)]
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if "RetroEmu" in str(k):
                continue
            if isinstance(v, str) and "RetroEmu" in v and "RetroCpuEmu" not in v:
                continue
            out[k] = drop_retroemu(v)
        return out
    return obj

con = sqlite3.connect(str(db_path))
cur = con.cursor()
cur.execute("SELECT key, value FROM ItemTable WHERE instr(value, 'RetroEmu') > 0")
rows = cur.fetchall()
print(f"state.vscdb RetroEmu keys: {len(rows)}")
for key, raw in rows:
    try:
        obj = json.loads(raw)
    except Exception:
        print(f"  skip non-json: {key}")
        continue
    neo = drop_retroemu(obj)
    new_raw = json.dumps(neo, ensure_ascii=False, separators=(",", ":"))
    cur.execute("UPDATE ItemTable SET value=? WHERE key=?", (new_raw, key))
    print(f"  scrubbed: {key}")
con.commit()
con.close()

# verify (instr: 大小文字区別。LIKE は retroemu リポジトリ名にも誤ヒットする)
con = sqlite3.connect(str(db_path))
cur = con.cursor()
cur.execute("SELECT key FROM ItemTable WHERE instr(value, 'RetroEmu') > 0")
left = [r[0] for r in cur.fetchall()]
con.close()
print("remaining keys:", left)
PY

# workspaceStorage / CachedConfigurations
for root in "${WS_ROOT}" "${CC_ROOT}"; do
  [ -d "${root}" ] || continue
  for d in "${root}"/*; do
    [ -f "${d}/workspace.json" ] || continue
    if grep -q RetroEmu "${d}/workspace.json" 2>/dev/null; then
      echo "remove $(basename "${d}") from ${root}"
      rm -rf "${d}"
    fi
  done
done

# Cursor project metadata
rm -rf "${HOME}/.cursor/projects/home-satotaka-RetroEmu-"* 2>/dev/null || true
rm -rf /mnt/c/Users/satot/.cursor/projects/wsl-localhost-Ubuntu-24-04-home-satotaka-RetroEmu-* 2>/dev/null || true

# 空の/スタブの RetroEmu ディレクトリを削除（中身がほぼ無い場合）
if [ -d "${HOME}/RetroEmu" ]; then
  if [ -z "$(find "${HOME}/RetroEmu" -mindepth 1 -maxdepth 2 2>/dev/null | head -5)" ]; then
    echo "空の ${HOME}/RetroEmu を削除します"
    rm -rf "${HOME}/RetroEmu"
  else
    echo "注意: ${HOME}/RetroEmu にファイルがあります。手動確認のうえ削除してください。"
    ls -la "${HOME}/RetroEmu" | head
  fi
fi

echo "完了。Cursor を起動し、Open Recent に RetroEmu が無いことを確認してください。"
echo "バックアップ: ${BACKUP_DIR}"
