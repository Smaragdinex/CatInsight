-- 一局結束存一筆。name 是玩家自己打的名字(沒打就用角色名),assets 是結算時的總資產
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  char TEXT NOT NULL,
  assets INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  players INTEGER NOT NULL,
  ai TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_assets ON records (assets DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_records_ip ON records (ip_hash, created_at DESC);
