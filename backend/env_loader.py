from __future__ import annotations

from pathlib import Path
import os


def _parse_env_line(line: str) -> tuple[str, str] | None:
    raw = line.strip()
    if not raw or raw.startswith("#") or "=" not in raw:
        return None
    key, value = raw.split("=", 1)
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    if not key:
        return None
    return key, value


def load_env_file(path: str | Path | None = None, override: bool = False) -> None:
    base_dir = Path(__file__).resolve().parent
    env_path = Path(path) if path is not None else base_dir / ".env"
    if not env_path.exists() or not env_path.is_file():
        return

    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(line)
            if not parsed:
                continue
            key, value = parsed
            if override or key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


load_env_file()
