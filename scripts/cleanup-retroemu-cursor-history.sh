#!/usr/bin/env bash
# Cursor / Windows が古い ~/RetroEmu パスを触ってディレクトリを作り直すのを止める。
#
# 使い方:
#   1. Cursor を完全終了（トレイアイコンも含む）推奨
#   2. bash ~/RetroCpuEmu/scripts/cleanup-retroemu-cursor-history.sh
#   3. Cursor を起動し、タスクバー右クリック / Open Recent に RetroEmu が無いことを確認
#
# 非対話: FORCE=1 bash ~/RetroCpuEmu/scripts/cleanup-retroemu-cursor-history.sh
set -euo pipefail

STAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR="${HOME}/.cursor/retroemu-cleanup-backup-${STAMP}"
mkdir -p "${BACKUP_DIR}"

STORAGE="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/storage.json"
STATE_DB="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
IDE_STATE="${HOME}/.cursor/ide_state.json"
WS_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/User/workspaceStorage"
WS_ROOT_SERVER="${HOME}/.cursor-server/data/User/workspaceStorage"
CC_ROOT="/mnt/c/Users/satot/AppData/Roaming/Cursor/CachedConfigurations/workspaces"
AD_ROOT="/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations"
CD_ROOT="/mnt/c/Users/satot/AppData/Roaming/Microsoft/Windows/Recent/CustomDestinations"
SNAPSHOT_ROOTS="${HOME}/.cursor-server/data/snapshots/roots"

# workspace.json が旧 RetroEmu パスを指しているか（RetroCpuEmu は除外）
is_orphan_retroemu_workspace_json() {
  local f="$1"
  [ -f "${f}" ] || return 1
  grep -E '/home/satotaka/RetroEmu(/|"|$)|/RetroEmu/RetroEmu\.code-workspace|%2FRetroEmu%2F' "${f}" >/dev/null 2>&1
}

if [ ! -f "${STORAGE}" ]; then
  echo "Cursor User データが見つかりません: ${STORAGE}"
  exit 1
fi

if pgrep -ai '[Cc]ursor' >/dev/null 2>&1; then
  echo "警告: Cursor プロセスが動いているようです。完全終了してから再実行してください。"
  if [ "${FORCE:-0}" != "1" ]; then
    echo "続行すると state.vscdb の更新に失敗することがあります。"
    read -r -p "それでも続行しますか? [y/N] " ans || true
    case "${ans:-}" in
      y|Y) ;;
      *) exit 1 ;;
    esac
  else
    echo "FORCE=1: 続行します"
  fi
fi

cp -a "${STORAGE}" "${BACKUP_DIR}/storage.json" 2>/dev/null || true
cp -a "${STATE_DB}" "${BACKUP_DIR}/state.vscdb" 2>/dev/null || true
cp -a "${STATE_DB}-shm" "${BACKUP_DIR}/" 2>/dev/null || true
cp -a "${STATE_DB}-wal" "${BACKUP_DIR}/" 2>/dev/null || true
cp -a "${IDE_STATE}" "${BACKUP_DIR}/ide_state.json" 2>/dev/null || true
echo "バックアップ: ${BACKUP_DIR}"

# --- Windows Jump Lists（これが起動時に WSL パスを触って mkdir する主因） ---
python3 - "${BACKUP_DIR}" "${AD_ROOT}" "${CD_ROOT}" <<'PY'
from pathlib import Path
import re, shutil, sys
backup, ad, cd = map(Path, sys.argv[1:4])

def orphan_retroemu(data: bytes) -> bool:
    for m in re.finditer(rb"RetroEmu", data):
        if data[max(0, m.start() - 3) : m.start()].endswith(b"Cpu"):
            continue
        return True
    return False

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
        if not orphan_retroemu(data):
            continue
        shutil.copy2(p, dest / p.name)
        p.unlink()
        removed += 1
        print(f"removed jump-list {p.name}")
print(f"jump-list files removed: {removed}")
PY

# state.vscdb は Cursor 起動中だと disk I/O error になり得るので失敗しても続行
if [ -f "${STATE_DB}" ]; then
set +e
python3 - "${STORAGE}" "${STATE_DB}" "${IDE_STATE}" <<'PY'
import json, re, sqlite3, sys
from pathlib import Path

storage_path, db_path, ide_path = map(Path, sys.argv[1:4])

def is_orphan_path(s: str) -> bool:
    if "RetroCpuEmu" in s and "/RetroEmu/" not in s and "RetroEmu.code-workspace" not in s:
        # RetroCpuEmu only
        if re.search(r"(?<!Cpu)RetroEmu", s):
            return True
        return False
    return bool(re.search(r"(?<!Cpu)RetroEmu", s))

def drop_orphan(obj):
    if isinstance(obj, list):
        out = []
        for x in obj:
            if is_orphan_path(json.dumps(x, ensure_ascii=False)):
                continue
            out.append(drop_orphan(x))
        return out
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if is_orphan_path(str(k)):
                continue
            if isinstance(v, str) and is_orphan_path(v):
                continue
            out[k] = drop_orphan(v)
        return out
    return obj

if storage_path.is_file():
    data = json.loads(storage_path.read_text(encoding="utf-8"))
    pa = data.setdefault("profileAssociations", {})
    ws = pa.get("workspaces", {})
    before = len(ws)
    pa["workspaces"] = {k: v for k, v in ws.items() if not is_orphan_path(k)}
    print(f"storage workspaces: {before} -> {len(pa['workspaces'])}")
    # openedPathsList / backupWorkspaces 等も再帰除去
    data = drop_orphan(data)
    storage_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if ide_path.is_file():
    ide = json.loads(ide_path.read_text(encoding="utf-8"))
    ide2 = drop_orphan(ide)
    ide_path.write_text(json.dumps(ide2, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {ide_path}")

con = sqlite3.connect(str(db_path), timeout=5)
cur = con.cursor()
cur.execute("SELECT key, value FROM ItemTable WHERE instr(value, 'RetroEmu') > 0")
rows = cur.fetchall()
print(f"state.vscdb RetroEmu keys: {len(rows)}")
for key, value in rows:
    try:
        obj = json.loads(value)
    except Exception:
        # 非 JSON: 孤児パスを含む生文字列なら削除
        if is_orphan_path(value):
            cur.execute("DELETE FROM ItemTable WHERE key = ?", (key,))
            print(f" deleted non-json key {key}")
        continue
    neo = drop_orphan(obj)
    if neo != obj:
        cur.execute(
            "UPDATE ItemTable SET value = ? WHERE key = ?",
            (json.dumps(neo, ensure_ascii=False), key),
        )
        print(f" updated key {key}")
    # 空になった配列/オブジェクトでキーごと消すケースは最低限
con.commit()
cur.execute("SELECT key FROM ItemTable WHERE instr(value, 'RetroEmu') > 0")
left = [r[0] for r in cur.fetchall()]
con.close()
print("remaining keys (may include RetroCpuEmu substring checks):", left)
PY
py_rc=$?
set -e
if [ "${py_rc}" -ne 0 ]; then
  echo "警告: storage/state.vscdb の更新に失敗しました (rc=${py_rc})。Cursor 終了後に再実行してください。"
fi
else
  echo "state.vscdb なし（スキップ）"
fi

# workspaceStorage / CachedConfigurations: 旧 RetroEmu を指すエントリを削除
for root in "${WS_ROOT}" "${WS_ROOT_SERVER}" "${CC_ROOT}"; do
  [ -d "${root}" ] || continue
  for d in "${root}"/*; do
    [ -d "${d}" ] || continue
    if is_orphan_retroemu_workspace_json "${d}/workspace.json"; then
      echo "remove orphan workspace $(basename "${d}") from ${root}"
      mkdir -p "${BACKUP_DIR}/workspaceStorage"
      cp -a "${d}" "${BACKUP_DIR}/workspaceStorage/" 2>/dev/null || true
      rm -rf "${d}"
    fi
  done
done

# 旧スナップショットルート
if [ -d "${SNAPSHOT_ROOTS}" ]; then
  for d in "${SNAPSHOT_ROOTS}"/RetroEmu-*; do
    [ -e "${d}" ] || continue
    echo "remove snapshot root $(basename "${d}")"
    rm -rf "${d}"
  done
fi

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
  # 内容を更新しつつ書き込み禁止を維持
  chmod u+w "${HOME}/RetroEmu" 2>/dev/null || true
  printf '%s' "${PLACEHOLDER_MSG}" > "${HOME}/RetroEmu"
  chmod 444 "${HOME}/RetroEmu"
  echo "プレースホルダファイルを更新: ${HOME}/RetroEmu"
elif [ -d "${HOME}/RetroEmu" ]; then
  echo "ERROR: ${HOME}/RetroEmu がディレクトリのままです（中身あり）。削除できませんでした。"
  exit 2
fi

# mkdir 阻止の確認
if mkdir "${HOME}/RetroEmu" 2>/dev/null; then
  echo "ERROR: mkdir が成功してしまいました（プレースホルダ失敗）"
  exit 3
else
  echo "mkdir 阻止 OK（ファイルがディレクトリ作成をブロック）"
fi

echo "完了。"
echo "バックアップ: ${BACKUP_DIR}"
echo "Cursor を再起動し、Open Recent / タスクバー右クリックに RetroEmu が無いことを確認してください。"
echo "もし再びディレクトリになる場合は、Cursor を完全終了してから FORCE=1 で再実行してください。"
