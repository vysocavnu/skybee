# Питає згоду в Discord: надсилає запит в особисті повідомлення від бота з реакціями ✅ / ❌ і чекає,
# яку з них поставиш ТИ (рахуються лише реакції власника — бот і будь-хто інший не можуть «погодити»).
# Реакції Discord читаються звичайним запитом, тож це працює і на ноутбуці, і в хмарних сесіях Claude,
# і одночасно з запущеним мостом scripts/dc_bot.py — ніхто нікому не заважає.
#
# Використання (текст запиту — зі stdin, щоб у ньому не виконувались $(...) чи `...`):
#   python scripts/dc_confirm.py [--git] [--push] [таймаут_секунд] <<'EOF'
#   текст запиту
#   EOF
#   --git: дописує гілку, підготовлені файли (git diff --cached) і нові коміти з GitHub,
#          а після «Так» перевіряє, що підготовлене (git write-tree) не змінилося.
#   --push: те саме для git push — коміти й файли, яких ще немає на GitHub; після «Так» HEAD не має змінитися.
#           Так викликає хук scripts/hooks/git_guard.py.
# Код виходу: 0 — «Так», 1 — «Ні», 2 — немає відповіді (таймаут), 3 — помилка,
#             4 — поки чекали, змінилися файли чи коміти. Будь-що, крім 0, — НЕ згода.
# Потрібні DC_BOT_TOKEN (токен бота) і DC_OWNER_ID (твій id у Discord). Бот і ти маєте бути на одному сервері.
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

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

TOKEN = os.environ.get("DC_BOT_TOKEN")
OWNER = os.environ.get("DC_OWNER_ID", "")
if not TOKEN or not OWNER:
    fail("DC_BOT_TOKEN / DC_OWNER_ID not set")
if not OWNER.isdigit():
    fail("DC_OWNER_ID must be your numeric Discord user id")

try:
    TEXT = sys.stdin.buffer.read().decode("utf-8", "replace").strip()[:1500]
except Exception:
    TEXT = ""
if not TEXT:
    fail("empty request text (pass it via stdin)")

API = os.environ.get("DC_API") or "https://discord.com/api/v10"
DEADLINE = START + TIMEOUT
YES, NO = "✅", "❌"


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True,
                          encoding="utf-8", errors="replace").stdout.strip()


def plain(s):
    # Без керівних символів: перенос у назві файлу не підробить запит.
    return "".join(c if c.isprintable() else "?" for c in s)


def call(method, path, payload=None, net=15):
    # Discord REST; на 429 чекає скільки скаже Discord і пробує ще (до 3 разів).
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
                time.sleep(min(10, float(info.get("retry_after", 1)) + .2))
                continue
            raise RuntimeError(f"discord {e.code}: {info.get('message') or e.reason}") from None


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
    if nfiles > 20:
        files = files[:20] + [f"…і ще {nfiles - 20}"]
    behind = git("rev-list", "--count", "HEAD..@{u}") if up else "0"

    # Людською мовою: які частини Skybee зачіпає (за шляхами файлів).
    AREAS = [
        (r"\.github/", "⚙️ збірки на GitHub (CI)"),
        (r"desktop/", "🖥️ десктопна програма"),
        (r"mobile/", "📱 телефони (Android, iOS)"),
        (r"flatpak/", "🐧 Linux (Flatpak)"),
        (r"\.claude/|scripts/(hooks/|dc_confirm|dc_bot|dc_notify|post|check_mail|bsky_search)|CLAUDE\.md", "🤖 агенти Claude і їхні правила"),
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
    what = "\n".join(c if c.startswith("…") else "• " + c.split(" ", 1)[-1] for c in commits)[:600]
    TEXT += ("\nЩо робить: заливає зміни на GitHub"
             + "\nКуди: " + plain(url.removeprefix("https://").removesuffix(".git")) + ", " + target
             + (f"\n\n⚠️ На GitHub є {behind} новіших комітів — push, найімовірніше, відхилять" if behind not in ("", "0") else "")
             + "\n\nДе:\n" + where
             + f"\n\nФайли ({nfiles}):\n" + ("\n".join(files_h) or "(немає)")
             + f"\n\nЩо змінюється ({total or '?'} коміт(ів)):\n" + (what or "(немає нових)"))

# Discord-повідомлення — до 2000 знаків; текст — без @-згадок (allowed_mentions порожній).
head = ("🚀 **Заливка на GitHub — потрібна твоя згода**\n\n" if PUSH else "🐝 **Skybee просить згоди**\n\n")
foot = f"\n\nПостав {YES} — дозволити, {NO} — скасувати."
body = head + TEXT
if len(body) > 2000 - len(foot):
    body = body[:2000 - len(foot) - 1] + "…"

CH = None
MSG = None


def finish(note):
    if not MSG:
        return
    try:
        call("POST", f"/channels/{CH}/messages", {"content": note, "allowed_mentions": {"parse": []},
                                                  "message_reference": {"message_id": MSG, "fail_if_not_exists": False}}, net=8)
    except Exception:
        pass


def done(code, word, note):
    finish(note)
    print(word)
    sys.exit(code)


def decide(yes):
    if yes and PUSH and git("rev-parse", "HEAD") != HEAD:
        done(4, "changed", "⚠️ Поки чекали, з'явилися нові коміти — нічого не запушено, спитаю ще раз")
    if yes and GIT and git("write-tree") != TREE:
        done(4, "changed", "⚠️ Поки чекали, файли змінилися — нічого не зроблено, спитаю ще раз")
    if yes:
        done(0, "yes", "✅ Дозволено")
    done(1, "no", "❌ Скасовано")


def reacted(emoji):
    # Чи поставив цю реакцію саме власник (у списку можуть бути бот і хтось іще — їх не рахуємо).
    users = call("GET", f"/channels/{CH}/messages/{MSG}/reactions/{urllib.parse.quote(emoji)}?limit=100") or []
    return any(str(u.get("id")) == OWNER for u in users)


try:
    CH = call("POST", "/users/@me/channels", {"recipient_id": OWNER})["id"]
    MSG = call("POST", f"/channels/{CH}/messages", {"content": body + foot, "allowed_mentions": {"parse": []}})["id"]
    for e in (YES, NO):
        call("PUT", f"/channels/{CH}/messages/{MSG}/reactions/{urllib.parse.quote(e)}/@me")
except Exception as e:
    fail(e)

errors = 0
while time.time() < DEADLINE:
    try:
        no, yes = reacted(NO), reacted(YES)
        errors = 0
    except Exception as e:
        errors += 1
        if errors >= 5:
            done(3, f"error: {e}", "⚠️ Немає зв'язку з Discord — нічого не зроблено")
        time.sleep(3)
        continue
    if no:          # «Ні» перемагає, якщо стоять обидві
        decide(False)
    if yes:
        decide(True)
    time.sleep(2)

done(2, "timeout", "⌛ Час вийшов — нічого не зроблено")
