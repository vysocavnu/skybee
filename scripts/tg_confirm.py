# Питає згоду в Telegram кнопками «Так / Ні» і чекає відповіді.
# Використання (текст запиту — зі stdin, щоб у ньому не виконувались $(...) чи `...`):
#   python scripts/tg_confirm.py [--git] [таймаут_секунд] <<'EOF'
#   текст запиту
#   EOF
#   --git: скрипт сам дописує гілку, підготовлені файли (git diff --cached) і нові коміти з GitHub,
#          а після «Так» перевіряє, що підготовлене (git write-tree) не змінилося.
#   --push: те саме для git push — коміти й файли, яких ще немає на GitHub; після «Так» HEAD не має змінитися.
#           Так викликає хук scripts/hooks/git_guard.py.
# Код виходу: 0 — «Так», 1 — «Ні», 2 — немає відповіді (таймаут), 3 — помилка,
#             4 — поки чекали, змінилися підготовлені файли. Будь-що, крім 0, — НЕ згода.
# Потрібні TG_BOT_TOKEN і TG_CHAT_ID (як у notify.py); TG_OWNER_ID — якщо чат груповий.
# Не запускати двічі одночасно: Telegram віддає оновлення лише одному читачеві.
import os, re, sys, json, time, secrets, subprocess, urllib.request, urllib.error

START = time.time()
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def fail(msg):
    print("error:", msg)
    sys.exit(3)


args = sys.argv[1:]
GIT = "--git" in args
PUSH = "--push" in args
args = [a for a in args if a not in ("--git", "--push")]
try:
    TIMEOUT = int(args[0]) if args else 540
except ValueError:
    fail("timeout must be a number")

TOKEN = os.environ.get("TG_BOT_TOKEN")
CHAT = os.environ.get("TG_CHAT_ID")
OWNER = os.environ.get("TG_OWNER_ID") or (CHAT if CHAT and not CHAT.startswith("-") else None)
if not TOKEN or not CHAT:
    fail("TG_BOT_TOKEN / TG_CHAT_ID not set")
if not OWNER:
    fail("group chat needs TG_OWNER_ID (who may approve)")

try:
    TEXT = sys.stdin.buffer.read().decode("utf-8", "replace").strip()[:1500]
except Exception:
    TEXT = ""
if not TEXT:
    fail("empty request text (pass it via stdin)")

API = f"https://api.telegram.org/bot{TOKEN}/"
DEADLINE = START + TIMEOUT


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True,
                          encoding="utf-8", errors="replace").stdout.strip()


def plain(s):
    # Без керівних символів: перенос у назві файлу не підробить запит.
    return "".join(c if c.isprintable() else "?" for c in s)


def call(method, payload, wait=0, net=10):
    req = urllib.request.Request(API + method, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=wait + net) as r:
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


TREE = None
if GIT:
    TREE = git("write-tree")
    files = [plain(l) for l in git("-c", "core.quotepath=on", "diff", "--cached",
                                   "--name-status").splitlines()]
    if len(files) > 30:
        files = files[:30] + [f"…і ще {len(files) - 30}"]
    incoming = [plain(l) for l in git("log", "--oneline", "HEAD..@{u}").splitlines()][:10]
    TEXT += ("\n\nГілка: " + plain(git("branch", "--show-current"))
             + "\nФайли до коміту:\n" + ("\n".join(files) or "(немає)")
             + "\nНове з GitHub:\n" + ("\n".join(incoming) or "нічого"))

HEAD = None
if PUSH:
    # Що саме піде на GitHub: коміти, яких там ще немає, і їхні файли.
    url = git("remote", "get-url", "--push", "origin")
    if not url:
        fail("no origin remote")
    try:
        subprocess.run(["git", "fetch", "-q", "origin"], capture_output=True, timeout=60)
    except Exception:
        pass  # без мережі покажемо за останнім відомим станом
    HEAD = git("rev-parse", "HEAD")
    branch = git("branch", "--show-current")
    up = git("rev-parse", "--abbrev-ref", "@{u}")
    if up:
        new = False
        total = git("rev-list", "--count", "@{u}..HEAD")
        commits = git("log", "--format=%h %<(80,trunc)%s", "-n", "15", "@{u}..HEAD")
        files = git("-c", "core.quotepath=on", "diff", "--name-status", "@{u}...HEAD")
    else:
        # Нова гілка: лише коміти, яких немає ніде на origin, і файли від точки відгалуження.
        new = True
        total = git("rev-list", "--count", "HEAD", "--not", "--remotes=origin")
        commits = git("log", "--format=%h %<(80,trunc)%s", "-n", "15", "HEAD", "--not", "--remotes=origin")
        main = "origin/HEAD" if git("rev-parse", "--verify", "-q", "origin/HEAD") else "origin/main"
        fork = git("merge-base", "HEAD", main)
        files = git("-c", "core.quotepath=on", "diff", "--name-status", fork, "HEAD") if fork else ""
    commits = [plain(l.rstrip()) for l in commits.splitlines()]
    if total.isdigit() and int(total) > len(commits):
        commits.append(f"…і ще {int(total) - len(commits)}")
    files = [plain(l) for l in files.splitlines()]
    # Чутливі файли (скрипти, CI, десктоп, налаштування) — завжди видно, нагорі.
    hot = re.compile(r"\s\"?(scripts/|\.github/|desktop/|\.claude/|mobile/|flatpak/|errors/|index\.html|sw\.js|CNAME"
                     r"|\.git(ignore|attributes|modules)|manifest\.webmanifest|404\.html)")
    files = [f for f in files if hot.search(f)] + [f for f in files if not hot.search(f)]
    nfiles = len(files)
    allfiles = list(files)
    if nfiles > 30:
        files = files[:30] + [f"…і ще {nfiles - 30}"]
    behind = git("rev-list", "--count", "HEAD..@{u}") if up else "0"

    # Людською мовою: які частини Skybee зачіпає (за шляхами файлів).
    AREAS = [
        (r"\.github/", "⚙️ збірки на GitHub (CI)"),
        (r"desktop/", "🖥️ десктопна програма"),
        (r"mobile/", "📱 телефони (Android, iOS)"),
        (r"flatpak/", "🐧 Linux (Flatpak)"),
        (r"\.claude/|scripts/(hooks/|tg_confirm|post|notify|check_mail|bsky_search)|CLAUDE\.md", "🤖 агенти Claude і їхні правила"),
        (r"scripts/", "🧰 службові скрипти"),
        (r"css/", "🎨 вигляд сайту"),
        (r"js/|index\.html|sw\.js|manifest|icons/|404\.html|offline\.html|errors/", "🌐 сайт і застосунок Skybee"),
        (r"docs/|README|\.md$", "📄 документація"),
    ]
    counts = {}
    for f in allfiles:
        path = f.split("\t")[-1].strip('"')
        label = next((lbl for pat, lbl in AREAS if re.search(pat, path)), "📦 інше")
        counts[label] = counts.get(label, 0) + 1
    where = "\n".join(f"• {lbl} — {n} файл(ів)" for lbl, n in counts.items()) or "• (немає змін у файлах)"
    kinds = {"A": "новий", "M": "змінено", "D": "видалено", "R": "перейменовано"}
    files_h = [(kinds.get(f[:1], f[:1]) + ": " + f.split("\t")[-1]) if "\t" in f else f for f in files]
    target = ("гілка " + plain(branch) + (" (нова на GitHub)" if new else "")
              + ("\nУ main (сайт) це потрапить лише після того, як ти зіллєш Pull Request." if branch != "main"
                 else "\n⚠️ Просто в main — сайт оновиться одразу."))

    # Важливе — нагорі: попередження, «Де» і файли не мають загубитися через ліміт довжини.
    # Список комітів — останнім і з власним обрізанням.
    what = "\n".join(c if c.startswith("…") else "• " + c.split(" ", 1)[-1] for c in commits)[:1200]
    TEXT += ("\nЩо робить: заливає зміни на GitHub"
             + "\nКуди: " + plain(url.removeprefix("https://").removesuffix(".git")) + ", " + target
             + (f"\n\n⚠️ На GitHub є {behind} новіших комітів — push, найімовірніше, відхилять" if behind not in ("", "0") else "")
             + "\n\nДе:\n" + where
             + f"\n\nФайли ({nfiles if new is False or allfiles else 'невідомо'}):\n" + ("\n".join(files_h) or "(немає)")
             + f"\n\nЩо змінюється ({total or '?'} коміт(ів)):\n" + (what or "(немає нових)"))

msg = None


def finish(note):
    if not msg:
        return
    for method, payload in (
        ("editMessageReplyMarkup", {"chat_id": CHAT, "message_id": msg["message_id"],
                                    "reply_markup": {"inline_keyboard": []}}),
        ("sendMessage", {"chat_id": CHAT, "text": note,
                         "reply_parameters": {"message_id": msg["message_id"]}}),
    ):
        try:
            call(method, payload, net=5)
        except Exception:
            pass


def done(code, word, note):
    finish(note)
    print(word)
    sys.exit(code)


BRIDGE = "http://127.0.0.1:47321"


def bridge(path, wait=3):
    # Міст scripts/tg_bot.py: він єдиний читає оновлення бота, натискання беремо в нього.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # без проксі: лише локальний порт
    with opener.open(BRIDGE + path, timeout=wait) as r:
        return json.load(r)


def genuine_bridge():
    # Хто слухає порт 47321? Довіряємо лише python, запущеному з -I саме з scripts/tg_bot.py цього
    # проєкту, і лише якщо файл не змінено відносно останнього коміту (його перевіряли й захищено).
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ps = ("$c=Get-NetTCPConnection -State Listen -LocalPort 47321 -ErrorAction SilentlyContinue|Select-Object -First 1;"
          "if($c){$p=Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\";"
          "[Console]::OutputEncoding=[Text.Encoding]::UTF8;Write-Output $p.ExecutablePath;Write-Output $p.CommandLine}")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                             timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        lines = out.decode("utf-8", "replace").strip().splitlines()
    except Exception:
        return False
    if len(lines) < 2:
        return False
    exe, cmdline = lines[0].strip(), lines[1].strip()
    if not re.search(r"(^|[\\/])pythonw?\.exe$", exe, re.I):
        return False
    want = os.path.join(root, "scripts", "tg_bot.py").lower().replace("/", "\\")
    m = re.fullmatch(r'"?[^"]*?pythonw?(\.exe)?"?\s+-I\s+"?([^"]+?)"?\s*', cmdline, re.I)
    if not m:
        return False
    got = m.group(2).replace("/", "\\")
    got = os.path.normpath(got if os.path.isabs(got) else os.path.join(root, got)).lower()
    if got != want:
        return False
    return git("status", "--porcelain", "--", "scripts/tg_bot.py") == "" and \
        bool(git("ls-files", "--", "scripts/tg_bot.py"))


try:
    USE_BRIDGE = bridge("/ping", 2).get("bridge") == "skybee"
except Exception:
    USE_BRIDGE = False
if USE_BRIDGE and not genuine_bridge():
    # На порту не той міст: не довіряємо йому і не читаємо бота самі (справжній міст міг би конфліктувати).
    fail("port 47321 is held by something that is not the genuine Skybee bot — refusing")


def decide(yes):
    if yes and PUSH and git("rev-parse", "HEAD") != HEAD:
        done(4, "changed", "⚠️ Поки чекали, з'явилися нові коміти — нічого не запушено, спитаю ще раз")
    if yes and GIT and git("write-tree") != TREE:
        done(4, "changed", "⚠️ Поки чекали, файли змінилися — нічого не зроблено, спитаю ще раз")
    if yes:
        done(0, "yes", "✅ Дозволено")
    done(1, "no", "❌ Скасовано")


try:
    offset = 0
    if not USE_BRIDGE:
        # Пропускаємо старі оновлення, щоб не спрацювало давнє натискання.
        last = call("getUpdates", {"offset": -1, "timeout": 0})
        offset = last[-1]["update_id"] + 1 if last else 0
    nonce = secrets.token_hex(8)
    msg = call("sendMessage", {
        "chat_id": CHAT,
        "text": ("🚀 Заливка на GitHub — потрібна твоя згода\n\n" if PUSH else "🐝 Skybee просить згоди\n\n") + TEXT[:3800],
        "reply_markup": {"inline_keyboard": [[
            {"text": "✅ Так", "callback_data": f"y:{nonce}"},
            {"text": "❌ Ні", "callback_data": f"n:{nonce}"},
        ]]},
    })
except Exception as e:
    fail(e)

errors = 0
while USE_BRIDGE:
    left = int(DEADLINE - time.time())
    if left < 1:
        done(2, "timeout", "⌛ Час вийшов — нічого не зроблено")
    try:
        ans = bridge(f"/wait?nonce={nonce}&mid={msg['message_id']}&timeout={min(25, left)}", min(25, left) + 10).get("answer")
        errors = 0
    except Exception as e:
        errors += 1
        if errors >= 5:
            done(3, f"error: bridge {e}", "⚠️ Немає зв'язку з Skybee-ботом — нічого не зроблено")
        time.sleep(min(3, max(0, DEADLINE - time.time())))
        continue
    if ans in ("y", "n"):
        decide(ans == "y")

while True:
    left = int(DEADLINE - time.time())
    if left < 1:
        break
    try:
        updates = call("getUpdates", {"offset": offset, "timeout": min(25, left),
                                      "allowed_updates": ["callback_query"]}, min(25, left))
        errors = 0
    except Exception as e:
        errors += 1
        if errors >= 5:
            done(3, f"error: {e}", "⚠️ Немає зв'язку з Telegram — нічого не зроблено")
        time.sleep(min(3, max(0, DEADLINE - time.time())))
        continue
    for u in updates:
        offset = u["update_id"] + 1
        cq = u.get("callback_query")
        if not cq:
            continue
        m = cq.get("message") or {}
        mine = (str(m.get("chat", {}).get("id")) == str(CHAT)
                and m.get("message_id") == msg["message_id"]
                and str(cq.get("from", {}).get("id")) == str(OWNER)
                and cq.get("data") in (f"y:{nonce}", f"n:{nonce}"))
        if not mine:
            try:
                call("answerCallbackQuery", {"callback_query_id": cq["id"], "text": "Запит застарів"}, net=5)
            except Exception:
                pass
            continue
        yes = cq["data"].startswith("y:")
        try:
            call("answerCallbackQuery", {"callback_query_id": cq["id"],
                                         "text": "Дозволено" if yes else "Скасовано"}, net=5)
        except Exception:
            pass
        decide(yes)

done(2, "timeout", "⌛ Час вийшов — нічого не зроблено")
