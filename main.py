import os
import sys


def _load_env_file(env_path=".env"):
    if not os.path.exists(env_path):
        return
    raw_bytes = b""
    with open(env_path, "rb") as f:
        raw_bytes = f.read()

    text = None
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            text = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw_bytes.decode("utf-8", errors="ignore")

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        if key and key not in os.environ:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            os.environ[key] = value


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    _load_env_file()
    if not os.environ.get("BOT_TOKEN"):
        print("BOT_TOKEN is missing in environment.", file=sys.stderr)
        sys.exit(1)

    # Node owns Telegram polling and the Render PORT. A second Flask server on
    # that port hides the Mini App and crashes Node with EADDRINUSE.
    os.execvp("node", ["node", "src/index.js"])


if __name__ == "__main__":
    main()
