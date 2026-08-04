#!/usr/bin/env bash
# Cursor / Windows が古い ~/RetroEmu パスを触ってディレクトリを作り直すのを止める。
#
# 使い方:
#   1. Cursor を完全終了（トレイアイコンも含む）
#   2. bash ~/RetroCpuEmu/scripts/cleanup-retroemu-cursor-history.sh
#   3. Cursor を起動し、タスクバー右クリック / Open Recent に RetroEmu が無いことを確認
set -euo pipefail

STAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR="${HOME}/.cursor/retroemu-cleanup-backup-${STAMP}"
mkdir -p "${BACKUP_DIR}"

STORAGE="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/storage.json"
STATE_DB="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
IDE_STATE="${HOME}/.cursor/ide_state.json"
WS_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/workspaceStorage"
CC_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/CachedConfigurations/workspaces"
AD_ROOT="/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations"
CD_ROOT="/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/CustomDestinations"

if [ ! -f "${STORAGE}" ] || [ ! -f "${STATE_DB}" ]; then
  echo "Cursor User データが見つかりません: ${STORAGE}"
  exit 1
fi

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

# --- Windows Jump Lists（これが起動時に WSL パスを触って mkdir する主因） ---
python3 - "${BACKUP_DIR}" "${AD_ROOT}" "${CD_ROOT}" <<'PY'
from pathlib import Path
import shutil, sys
backup, ad, cd = map(Path, sys.argv[1:4])
removed = 0
for root in (ad, cd):
    if not root.is_dir():
        continue
    dest = backup / root.name
    dest.mkdir(parents=True, exist_ok=True)
    for p in root.iterdir():
        if not p.is_file():
            continue
        try:
            data = p.read_bytes()
        except OSError as e:
            print(f"skip {p}: {e}")
            continue
        if b"RetroEmu" not in data:
            continue
        shutil.copy2(p, dest / p.name)
        p.unlink()
        removed += 1
        print(f"removed jump-list {p.name} (hits={data.count(b'RetroEmu')})")
print(f"jump-list files removed: {removed}")
PY

python3 - "${STORAGE}" "${STATE_DB}" "${IDE_STATE}" <<'PY'
import json, sqlite3, sys
from pathlib import Path

storage_path, db_path, ide_path = map(Path, sys.argv[1:4])

data = json.loads(storage_path.read_text(encoding="utf-8"))
pa = data.setdefault("profileAssociations", {})
ws = pa.get("workspaces", {})
if isinstance(ws, dict):
    before = len(ws)
    pa["workspaces"] = {k: v for k, v in ws.items() if "RetroEmu" not in k}
    print(f"profileAssociations.workspaces: {before} -> {len(pa['workspaces'])}")
storage_path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")

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
# LIKE は誤ヒットしやすいので instr を使う
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

con = sqlite3.connect(str(db_path))
cur = con.cursor()
cur.execute("SELECT key FROM ItemTable WHERE instr(value, 'RetroEmu') > 0")
left = [r[0] for r in cur.fetchall()]
con.close()
print("remaining keys:", left)
PY

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

rm -rf "${HOME}/.cursor/projects/home-satotaka-RetroEmu-"* 2>/dev/null || true
rm -rf /mnt/c/Users/satot/.cursor/projects/wsl-localhost-Ubuntu-24-04-home-satotaka-RetroEmu-* 2>/dev/null || true

# ディレクトリなら空なら削除。ファイルプレースホルダで再 mkdir を阻止する
PLACEHOLDER_MSG=$'このパスは旧プロジェクト名です。実体は ~/RetroCpuEmu を使ってください。\n（ディレクトリ再作成防止用のプレースホルダファイル。削除しないでください）\n'
if [ -d "${HOME}/RetroEmu" ]; then
  if [ -z "$(find "${HOME}/RetroEmu" -type f 2>/dev/null | head -3)" ]; then
    echo "空の ${HOME}/RetroEmu ディレクトリを削除します"
    rm -rf "${HOME}/RetroEmu"
  else
    echo "注意: ${HOME}/RetroEmu にファイルがあります。手動で確認・削除してください。"
    ls -la "${HOME}/RetroEmu" | head
  fi
fi
if [ ! -e "${HOME}/RetroEmu" ]; then
  printf '%s' "${PLACEHOLDER_MSG}" > "${HOME}/RetroEmu"
  chmod 444 "${HOME}/RetroEmu"
  echo "プレースホルダファイルを作成: ${HOME}/RetroEmu"
elif [ -f "${HOME}/RetroEmu" ]; then
  echo "プレースホルダファイルは既にあります: ${HOME}/RetroEmu"
fi

echo "完了。"
echo "バックアップ: ${BACKUP_DIR}"
echo "Cursor を起動し、タスクバー右クリックに RetroEmu が無いことを確認してください。"
