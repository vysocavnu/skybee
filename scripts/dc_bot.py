# Міст Discord ↔ Claude: пишеш боту в особисті повідомлення — Claude працює в теці Skybee і відповідає там же.
# Бот раз на кілька секунд читає ваш особистий чат (звичайними запитами, без сторонніх бібліотек).
# Згоди «Так / Ні» (dc_confirm.py) сюди не проходять — вони читають реакції самі, тож міст для них не потрібен.
#
# Запуск:  python -I scripts/dc_bot.py   (або scripts/start_dc_bot.cmd — у згорнутому вікні)
# Потрібні DC_BOT_TOKEN і DC_OWNER_ID; бот і ти маєте бути на одному сервері Discord.
# Команди в чаті: /new — нова розмова, /stop — зупинити поточну роботу, /status, /help.
#
# Безпека: виконуються ЛИШЕ твої повідомлення (author.id = DC_OWNER_ID) в особистому чаті з ботом.
# Решта ігнорується. Хто має доступ до твого Discord — керує цим комп'ютером: увімкни 2FA в Discord.
import json, os, queue, re, subprocess, sys, threading, time, urllib.error, urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(os.path.expanduser("~"), ".skybee-bot")
TOKEN = os.environ.get("DC_BOT_TOKEN")
OWNER = os.environ.get("DC_OWNER_ID", "")
API = os.environ.get("DC_API") or "https://discord.com/api/v10"
CLAUDE = os.environ.get("SKYBEE_CLAUDE") or "claude"
SYSTEM = ("Повідомлення прийшло з Discord від власника проєкту Skybee. Відповідай українською, коротко, "
          "простим текстом (без таблиць і великих блоків коду — це чат). Дотримуйся CLAUDE.md. "
          "Push і пости — лише через звичні скрипти (вони самі спитають згоди в Discord).")
RUN_TIMEOUT = 45 * 60
POLL = 3  # секунд між перевірками чату


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


if not TOKEN or not OWNER.isdigit():
    log("немає DC_BOT_TOKEN / DC_OWNER_ID — міст не запущено")
    sys.exit("Потрібні DC_BOT_TOKEN і DC_OWNER_ID (твій числовий id у Discord).")


def call(method, path, payload=None, net=20):
    # Discord REST; на 429 чекає скільки скаже Discord.
    for attempt in range(4):
        req = urllib.request.Request(API + path, method=method,
                                     data=None if payload is None else json.dumps(payload).encode(),
                                     headers={"Authorization": "Bot " + TOKEN, "Content-Type": "application/json",
                                              "User-Agent": "DiscordBot (https://github.com/vysocavnu/skybee, 1.0)"})
        try:
            with urllib.request.urlopen(req, timeout=net) as r:
                body = r.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            try:
                info = json.load(e)
            except Exception:
                info = {}
            if e.code == 429 and attempt < 3:
                time.sleep(min(30, float(info.get("retry_after", 1)) + .2))
                continue
            raise RuntimeError(f"discord {e.code}: {info.get('message') or e.reason}") from None


CH = None  # особистий чат бота з тобою


def chunks(text, size=1900):
    # Discord — до 2000 знаків; ріжемо з запасом і по можливості по переносах рядків.
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
        p = {"content": part, "allowed_mentions": {"parse": []}}
        if reply_to and n == 0:
            p["message_reference"] = {"message_id": reply_to, "fail_if_not_exists": False}
        for attempt in range(3):
            try:
                call("POST", f"/channels/{CH}/messages", p)
                break
            except Exception as e:
                log("send failed:", e)
                time.sleep(3 * (attempt + 1))


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


def save_session(sid):
    os.makedirs(STATE, exist_ok=True)
    with open(session_file(), "w", encoding="utf-8") as f:
        json.dump({"id": sid}, f)


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


def run_claude(text, mid):
    sid = load_session()
    cmd = [CLAUDE, "-p", "--output-format", "json", "--permission-mode", "auto", "--append-system-prompt", SYSTEM]
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
        return say("⌛ Робота тривала понад 45 хв — зупинив. Напиши, що зробити далі.", mid)
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
    # «Бот друкує…» у Discord тримається ~10 с — оновлюємо, поки Claude працює.
    while True:
        if current["proc"]:
            try:
                call("POST", f"/channels/{CH}/typing")
            except Exception:
                pass
        time.sleep(8)


HELP = ("🐝 Я — Claude у проєкті Skybee. Пиши, що зробити, — я працюю на твоєму комп'ютері й відповідаю тут.\n"
        "/new — почати нову розмову\n/stop — зупинити поточну роботу\n/status — що зараз роблю\n"
        "Заливка на GitHub і пости в Bluesky — як і раніше, лише після твоєї реакції ✅.")


def on_message(m):
    if str(m.get("author", {}).get("id")) != OWNER or m.get("author", {}).get("bot"):
        return  # не власник (зокрема сам бот) — мовчки ігноруємо
    if m.get("type") not in (0, 19):
        return  # системні повідомлення
    mid = m.get("id")
    ref = m.get("message_reference") or {}
    if m.get("message_snapshots") or ref.get("type") == 1:
        return say("Переслані повідомлення не виконую — це чужий текст. Напиши своїми словами.", mid)
    text = (m.get("content") or "").strip()
    if not text:
        return say("Поки розумію лише текст.", mid)
    cmd = text.split()[0].lower()
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
    global CH
    # Під час автозапуску мережі може ще не бути — чекаємо, а не падаємо.
    delay = 5
    while True:
        try:
            CH = call("POST", "/users/@me/channels", {"recipient_id": OWNER})["id"]
            last = call("GET", f"/channels/{CH}/messages?limit=1") or []
            break
        except Exception as e:
            log("старт: немає зв'язку з Discord:", e)
            time.sleep(delay)
            delay = min(120, delay * 2)
    after = last[0]["id"] if last else "0"  # старі повідомлення не виконуємо
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=typing, daemon=True).start()
    log("міст запущено")
    say("🐝 Skybee-бот на зв'язку. Пиши, що зробити (/help — довідка).")
    errors = 0
    while True:
        try:
            msgs = call("GET", f"/channels/{CH}/messages?after={after}&limit=50") or []
            errors = 0
        except Exception as e:
            errors += 1
            log("poll error:", e)
            time.sleep(min(60, 3 * errors))
            continue
        for m in sorted(msgs, key=lambda x: int(x["id"])):  # Discord віддає від нових до старих
            after = m["id"]
            try:
                on_message(m)
            except Exception as e:
                log("message error:", e)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
