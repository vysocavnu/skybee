# Міст Telegram ↔ Claude: пишеш боту — Claude працює в теці Skybee і відповідає в чат.
# Він же — єдиний, хто читає оновлення бота: натискання «Так / Ні» з tg_confirm.py
# приходять сюди й передаються через локальний порт 127.0.0.1:47321 (лише цей комп'ютер).
#
# Запуск:  python scripts/tg_bot.py         (або pythonw — без вікна)
# Потрібні TG_BOT_TOKEN, TG_CHAT_ID (твій особистий чат з ботом); TG_OWNER_ID — якщо інший.
# Команди в чаті: /new — нова розмова, /stop — зупинити поточну роботу, /status, /help.
#
# Безпека: виконуються ЛИШЕ повідомлення від власника (from.id) в особистому чаті (chat.id).
# Решта ігнорується. Хто має доступ до твого Telegram — керує цим комп'ютером: тримай 2FA в Telegram.
import json, os, queue, re, socket, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 47321
STATE = os.path.join(os.path.expanduser("~"), ".skybee-bot")
TOKEN = os.environ.get("TG_BOT_TOKEN")
CHAT = os.environ.get("TG_CHAT_ID")
OWNER = os.environ.get("TG_OWNER_ID") or CHAT
if not TOKEN or not CHAT or not OWNER or CHAT.startswith("-"):
    try:
        os.makedirs(STATE, exist_ok=True)
        with open(os.path.join(STATE, "bot.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + "немає TG_BOT_TOKEN / TG_CHAT_ID особистого чату — міст не запущено\n")
    except Exception:
        pass
    sys.exit("Потрібні TG_BOT_TOKEN і TG_CHAT_ID особистого чату з ботом (не групи).")
API = f"https://api.telegram.org/bot{TOKEN}/"
CLAUDE = os.environ.get("SKYBEE_CLAUDE") or "claude"
SYSTEM = ("Повідомлення прийшло з Telegram від власника проєкту Skybee. Відповідай українською, коротко, "
          "простим текстом (без таблиць і великих блоків коду — це чат у телефоні). Дотримуйся CLAUDE.md. "
          "Push і пости — лише через звичні скрипти (вони самі спитають згоди в Telegram).")
RUN_TIMEOUT = 45 * 60


def log(*a):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a)
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:  # під pythonw консолі немає — пишемо ще й у файл
        os.makedirs(STATE, exist_ok=True)
        with open(os.path.join(STATE, "bot.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def call(method, payload, wait=0):
    req = urllib.request.Request(API + method, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=wait + 15) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            desc = json.load(e).get("description")
        except Exception:
            desc = None
        raise RuntimeError(f"telegram {e.code}: {desc or e.reason}") from None
    if not res.get("ok"):
        raise RuntimeError(res.get("description", "telegram error"))
    return res["result"]


def chunks(text, size=3500):
    # Telegram рахує 4096 одиниць UTF-16 — ріжемо з запасом і по можливості по переносах рядків.
    while text:
        if len(text) <= size:
            yield text
            return
        cut = text.rfind("\n", 0, size)
        cut = cut if cut > size // 2 else size
        yield text[:cut]
        text = text[cut:].lstrip("\n")


def say(text, reply_to=None):
    text = (text or "").strip() or "(порожня відповідь)"
    for n, part in enumerate(chunks(text)):
        p = {"chat_id": CHAT, "text": part}
        if reply_to and n == 0:
            p["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        for attempt in range(3):
            try:
                call("sendMessage", p)
                break
            except Exception as e:
                log("send failed:", e)
                time.sleep(3 * (attempt + 1))  # 429 / мережа — трохи чекаємо


# ---------- згоди: tg_confirm.py чекає тут на натискання ----------
waiters = {}          # nonce -> {"mid": message_id, "answer": None|"y"|"n", "ev": Event, "t": time}
wlock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Лише з цього комп'ютера і без браузерних запитів з інших сайтів.
        if self.client_address[0] != "127.0.0.1" or self.headers.get("Origin") or self.headers.get("Referer") \
                or self.headers.get("Host") not in (f"127.0.0.1:{PORT}",):  # DNS rebinding
            return self._send(403, {"error": "forbidden"})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/ping":
            return self._send(200, {"ok": True, "bridge": "skybee"})
        if u.path != "/wait":
            return self._send(404, {"error": "not found"})
        nonce, mid = q.get("nonce", ""), q.get("mid", "")
        if not (16 <= len(nonce) <= 64 and nonce.isalnum() and mid.isdigit()):
            return self._send(400, {"error": "bad request"})
        try:
            wait = max(1, min(30, int(q.get("timeout", "25"))))
        except ValueError:
            wait = 25
        with wlock:
            if nonce not in waiters and len(waiters) >= 50:
                return self._send(429, {"error": "too many"})
            w = waiters.setdefault(nonce, {"mid": int(mid), "answer": None, "ev": threading.Event(), "t": time.time()})
            if w["mid"] != int(mid):
                return self._send(409, {"error": "mismatch"})
            w["t"] = time.time()  # «живий», поки tg_confirm питає
        w["ev"].wait(wait)
        return self._send(200, {"answer": w["answer"]})


def on_callback(cq):
    data = str(cq.get("data") or "")
    m = cq.get("message") or {}
    ok_sender = (str(cq.get("from", {}).get("id")) == str(OWNER) and str(m.get("chat", {}).get("id")) == str(CHAT))
    kind, _, nonce = data.partition(":")
    with wlock:
        w = waiters.get(nonce)
        valid = ok_sender and kind in ("y", "n") and w and w["answer"] is None and w["mid"] == m.get("message_id")
        if valid:
            w["answer"] = kind
            w["ev"].set()
    try:
        call("answerCallbackQuery", {"callback_query_id": cq["id"],
                                     "text": ("Дозволено" if kind == "y" else "Скасовано") if valid else "Запит застарів"})
    except Exception:
        pass


def cleanup():
    with wlock:
        for k in [k for k, w in waiters.items() if time.time() - w["t"] > 20 * 60]:
            waiters.pop(k, None)


# ---------- робота Claude ----------
jobs = queue.Queue()
current = {"proc": None, "text": None, "since": None}
clock = threading.Lock()


def session_file():
    return os.path.join(STATE, "session.json")


def load_session():
    try:
        with open(session_file(), encoding="utf-8") as f:
            sid = json.load(f).get("id")
        return sid if isinstance(sid, str) and re.fullmatch(r"[\w-]{8,80}", sid) else None
    except Exception:
        return None


def kill_tree(p):
    # claude запускає bash/git/хуки — зупиняємо все дерево процесів.
    try:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True, timeout=15,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        pass
    try:
        p.kill()
    except Exception:
        pass


def save_session(sid):
    os.makedirs(STATE, exist_ok=True)
    with open(session_file(), "w", encoding="utf-8") as f:
        json.dump({"id": sid}, f)


def run_claude(text, mid):
    sid = load_session()
    cmd = [CLAUDE, "-p", "--output-format", "json", "--permission-mode", "auto",
           "--append-system-prompt", SYSTEM]
    if sid:
        cmd += ["--resume", sid]
    log("run:", text[:80].replace("\n", " "))
    try:
        p = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except FileNotFoundError:
        return say("Не знайшов програму claude. Перевір, що Claude Code встановлено (команда `claude`).", mid)
    p.stopped = False
    with clock:
        current.update(proc=p, text=text, since=time.time())
    try:
        out, err = p.communicate(text.encode("utf-8"), timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        kill_tree(p)
        try:
            p.communicate(timeout=10)
        except Exception:
            pass
        say("⌛ Робота тривала понад 45 хв — зупинив. Напиши, що зробити далі.", mid)
        return
    finally:
        with clock:
            current.update(proc=None, text=None, since=None)
    if p.stopped:
        return say("⏹ Зупинено. Що зроблено до зупинки — лишилось як є.", mid)
    if p.returncode and not out:
        tail = err.decode("utf-8", "replace").strip()[-600:]
        if sid and "session" in tail.lower():
            save_session("")  # стару розмову не знайдено — почнемо нову наступного разу
        return say("⚠️ Claude завершився з помилкою:\n" + (tail or f"код {p.returncode}"), mid)
    try:
        res = json.loads(out.decode("utf-8", "replace"))
    except ValueError:
        return say(out.decode("utf-8", "replace")[-3500:], mid)
    if res.get("session_id"):
        save_session(res["session_id"])
    say(("⚠️ " if res.get("is_error") else "") + str(res.get("result") or "(готово, без тексту)"), mid)


def worker():
    while True:
        text, mid = jobs.get()
        try:
            run_claude(text, mid)
        except Exception as e:
            log("worker error:", e)
            say(f"⚠️ Не вдалося виконати: {type(e).__name__}", mid)


def typing():
    while True:
        if current["proc"]:
            try:
                call("sendChatAction", {"chat_id": CHAT, "action": "typing"})
            except Exception:
                pass
        time.sleep(5)


HELP = ("🐝 Я — Claude у проєкті Skybee. Пиши, що зробити, — я працюю на твоєму комп'ютері й відповідаю тут.\n"
        "/new — почати нову розмову\n/stop — зупинити поточну роботу\n/status — що зараз роблю\n"
        "Заливка на GitHub і пости в Bluesky — як і раніше, лише після твого «Так».")


def on_message(m):
    if str(m.get("from", {}).get("id")) != str(OWNER) or str(m.get("chat", {}).get("id")) != str(CHAT):
        return  # не власник або не особистий чат — мовчки ігноруємо
    mid = m.get("message_id")
    if m.get("forward_origin") or m.get("forward_from") or m.get("forward_from_chat") or m.get("via_bot"):
        return say("Переслані повідомлення не виконую — це чужий текст. Напиши своїми словами.", mid)
    text = (m.get("text") or m.get("caption") or "").strip()
    if not text:
        return say("Поки розумію лише текст.", mid)
    cmd = text.split()[0].split("@")[0].lower()
    if cmd in ("/start", "/help"):
        return say(HELP, mid)
    if cmd == "/new":
        save_session("")
        return say("🆕 Нова розмова. Пиши, що зробити.", mid)
    with clock:
        p, since, doing = current["proc"], current["since"], current["text"]
    if cmd == "/status":
        if p and since:
            mins = int((time.time() - since) / 60)
            return say(f"⏳ Працюю {mins} хв над: {(doing or '')[:200]}\nУ черзі: {jobs.qsize()}", mid)
        return say(f"😴 Вільний. У черзі: {jobs.qsize()}", mid)
    if cmd == "/stop":
        if p:
            p.stopped = True  # позначка на самому процесі — не зачепить наступне завдання
            kill_tree(p)
            return say("⏹ Зупиняю…", mid)
        return say("Нічого не виконується.", mid)
    queued = jobs.qsize() + (1 if current["proc"] else 0)
    say("⏳ Взявся." if not queued else f"🕐 У черзі (переді мною {queued}).", mid)
    jobs.put((text, mid))


def main():
    class ExclusiveServer(ThreadingHTTPServer):
        allow_reuse_address = False  # інакше на Windows другий міст «сяде» на той самий порт

        def server_bind(self):
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    try:
        srv = ExclusiveServer(("127.0.0.1", PORT), Handler)
    except OSError:
        log(f"Порт {PORT} зайнятий — міст уже запущений?")
        sys.exit(1)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=typing, daemon=True).start()
    try:
        call("deleteWebhook", {"drop_pending_updates": False})
    except Exception:
        pass
    # Пропускаємо все, що прийшло, поки міст не працював (старі команди не виконуємо).
    # Під час автозапуску мережі може ще не бути — чекаємо, а не падаємо.
    delay = 5
    while True:
        try:
            last = call("getUpdates", {"offset": -1, "timeout": 0})
            break
        except Exception as e:
            log("старт: немає зв'язку з Telegram:", e)
            time.sleep(delay)
            delay = min(120, delay * 2)
    offset = last[-1]["update_id"] + 1 if last else 0
    log("міст запущено")
    say("🐝 Skybee-бот на зв'язку. Пиши, що зробити (/help — довідка).")
    errors = 0
    while True:
        try:
            ups = call("getUpdates", {"offset": offset, "timeout": 25,
                                      "allowed_updates": ["message", "callback_query"]}, 25)
            errors = 0
        except Exception as e:
            errors += 1
            log("poll error:", e)
            time.sleep(min(60, 3 * errors))
            continue
        for u in ups:
            offset = u["update_id"] + 1
            try:
                if "callback_query" in u:
                    on_callback(u["callback_query"])
                elif "message" in u:
                    on_message(u["message"])
            except Exception as e:
                log("update error:", e)
        cleanup()


if __name__ == "__main__":
    main()
