# Сповіщення в Telegram через бота.
# TG_BOT_TOKEN — токен від @BotFather, TG_CHAT_ID — твій chat id.
# Текст — аргументом або (краще, щоб у ньому не виконувались $(...) і `...`) зі stdin:
#   python scripts/notify.py <<'EOF'
#   текст
#   EOF
import os, sys, json, urllib.request

if len(sys.argv) > 1:
    text = sys.argv[1]
else:
    text = sys.stdin.buffer.read().decode("utf-8", "replace")
text = text.strip()
if not text:
    print("error: empty text")
    sys.exit(3)
url = f"https://api.telegram.org/bot{os.environ['TG_BOT_TOKEN']}/sendMessage"
data = json.dumps({"chat_id": os.environ["TG_CHAT_ID"], "text": "📬 " + text[:4000]}).encode()
urllib.request.urlopen(urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}), timeout=20)
print("sent")
