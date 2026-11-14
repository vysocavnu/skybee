# Сповіщення в Discord: бот пише тобі в особисті повідомлення.
# DC_BOT_TOKEN — токен бота, DC_OWNER_ID — твій id у Discord (бот і ти — на одному сервері).
# Текст — аргументом або (краще, щоб у ньому не виконувались $(...) і `...`) зі stdin:
#   python scripts/dc_notify.py <<'EOF'
#   текст
#   EOF
import json, os, sys, urllib.request

API = os.environ.get("DC_API") or "https://discord.com/api/v10"
HEADERS = {"Authorization": "Bot " + os.environ["DC_BOT_TOKEN"], "Content-Type": "application/json",
           "User-Agent": "DiscordBot (https://github.com/vysocavnu/skybee, 1.0)"}


def call(path, payload):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(), headers=HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.buffer.read().decode("utf-8", "replace")
text = text.strip()
if not text:
    print("error: empty text")
    sys.exit(3)
ch = call("/users/@me/channels", {"recipient_id": os.environ["DC_OWNER_ID"]})["id"]
call(f"/channels/{ch}/messages", {"content": ("📬 " + text)[:2000], "allowed_mentions": {"parse": []}})
print("sent")
