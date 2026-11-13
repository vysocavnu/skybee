# Хук PreToolUse (Bash/PowerShell): жоден `git push` не піде без «Так» у Telegram.
# Агент не може підробити згоду — хук сам надсилає запит і сам чекає натискання.
#
# Правила:
#  * push у будь-якому вигляді (git, обгортки, змінні, eval, python -c) → дозволені лише точні форми
#    `git push`, `git push origin <поточна гілка>`, `git push -u origin <поточна гілка>` —
#    і лише після «Так» у Telegram. Решта — блок.
#  * Аліаси, git-хуки, credential, send-pack, apply/am, clean, stash -u, небезпечні -c,
#    зміна remote/config/upstream — блок.
#  * gh / GitHub API, що змінюють репозиторій — блок.
#  * Bluesky напряму (atproto, createRecord, пароль) — блок; постити лише через scripts/post.py.
#  * Захищені файли (хук, скрипти згоди, .git, налаштування Claude і git, профілі оболонки):
#    дозволено лише читати їх і запускати скрипти — будь-яка інша команда з ними — блок.
#  * Будь-яка помилка самого хука — блок (fail-closed).
# Це фільтр від випадкового й простого обходу, а не від усього (скрипт, записаний у файл,
# хук не бачить). Справжню гарантію дає правило на GitHub: заборона прямого push у main.
import fnmatch, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = "github.com/vysocavnu/skybee"
SEP = r"&&|\|\||[;|\n]"
# Heredoc, тіло якого — лише текст: лише з лапками в розділювачі (<<'EOF' — без підстановок).
SAFE_HEREDOC = re.compile(r"(?:^|[\s;&|])(?:cat|python3?(?:\.exe)?\s+(?:\S*[/\\])?scripts[/\\](?:notify|post|tg_confirm)\.py[^\n<]*"
                          r"|git\s+(?:commit|tag)\b[^\n<]*\s-F\s*-)\s*$", re.I)
SAFE_SUBST_CAT = re.compile(r"git\s+(?:commit|tag)\b[^\n<]*\s(?:-[a-z]*m|--message)[\s=]*\"?\$\(cat\s*$", re.I)
PROTECTED_FILES = ["scripts/hooks/git_guard.py", "scripts/tg_confirm.py", "scripts/post.py", "scripts/notify.py",
                   "scripts/check_mail.py", "scripts/bsky_search.py", ".claude/settings.json",
                   ".claude/settings.local.json", ".git/config", ".git/hooks/pre-push"]
PROTECTED = re.compile(r"scripts/hooks|hooks/|git_guard|tg_confirm|settings\.json|scripts/(post|notify|check_mail|bsky_search)\.py|\.claude/|\.claude\b"
                       r"|settings\.local|\.gitconfig|\.config/git|/git/config|(^|[^\w])\.git([/\s'\"),]|$)"
                       r"|\.bashrc|\.bash_profile|\.bash_login|\.profile\b|\.zshrc|\.zprofile|profile\.ps1|\$profile"
                       r"|/etc/(bash|profile|gitconfig)|\.inputrc")
READERS = {"cat", "type", "gc", "get-content", "grep", "egrep", "rg", "select-string", "sls", "head", "tail", "less",
           "more", "ls", "dir", "gci", "get-childitem", "wc", "file", "stat", "test", "[", "echo", "printf", "md5sum",
           "sha256sum", "get-filehash", "test-path", "resolve-path", "realpath", "find", "du", "findstr",
           "cd", "pushd", "popd", "set-location", "sl", "chdir", "for", "foreach", "node", "npm", "npx"}
WRITERS = re.compile(r"^(rm|del|erase|rd|rmdir|ri|remove-item|mv|move|mi|move-item|cp|copy|cpi|copy-item|ln|unlink"
                     r"|truncate|dd|tee|sed|awk|perl|patch|chmod|chown|install|ni|new-item|sc|set-content|ac"
                     r"|add-content|out-file|rni|rename-item|ren|curl|wget|iwr|invoke-webrequest|python[\d.]*|py)(\.exe)?$")
TEXT_SEARCH = {"grep", "egrep", "rg", "select-string", "sls", "findstr"}
GIT_READ = {"diff", "log", "show", "status", "add", "commit", "blame", "ls-files", "check-ignore", "rev-parse", "grep"}
WRAPPERS = {"eval", "xargs", "iex", "invoke-expression", "invoke-command", "&", ".", "source", "sh", "bash", "zsh",
            "dash", "pwsh", "powershell", "cmd", "cmd.exe", "start-process", "env", "exec", "command", "nohup", "timeout",
            "watch", "sudo", "parallel", "busybox", "call", "start", "saps", "icm"}
SAFE_C = re.compile(r"(core\.quotepath|color\.\w+|core\.autocrlf|core\.safecrlf|i18n\.\w+|user\.(name|email)"
                    r"|log\.\w+|advice\.\w+|init\.defaultbranch)=\S*")
INTERP = r"(?<![\w.-])(python[\d.]*|py|node|deno|bun|perl|ruby|php|osascript|wscript|cscript)(\.exe)?\s*(-[a-z]*[cep](?![a-z-])|-(\s|$))"


def deny(reason):
    # ensure_ascii: кирилиця не зламається в консолі Windows (cp1251)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def strip_heredocs(cmd):
    # Тіло вирізаємо лише для <<'EOF' (у лапках), яке читає безпечна команда, і без нічого після на рядку.
    # `$(cat <<'EOF'` — лише всередині `git commit -m "$(cat <<'EOF' … )"`. Інакше тіло — код, перевіряємо.
    out, pos = [], 0
    for m in re.finditer(r"<<-?\s*(['\"]?)(\w+)\1([^\n]*)\n(.*?)\n\s*\2\b", cmd, re.S):
        head = cmd[:m.start()].rsplit("\n", 1)[-1]
        tail = m.group(3)
        safe = m.group(1) and re.fullmatch(r"[\s)\"']*", tail) and (
            SAFE_SUBST_CAT.search(head) if re.search(r"\$\(\s*cat\s*$", head) else SAFE_HEREDOC.search(head))
        out.append(cmd[pos:m.start()])
        out.append(" <<HEREDOC " + tail + "\n" + ("" if safe else m.group(4) + "\n"))
        pos = m.end()
    out.append(cmd[pos:])
    return "".join(out)


def strip_messages(text):
    # Повідомлення коміту/тегу в лапках, без підстановок усередині — це текст, не код.
    pat = re.compile(r"((?<![\w.-])git(?:\.exe)?\s+(?:commit|tag)\b[^;&|\n]*?\s)(?:-[a-z]*m|--message)(?:\s*|=)"
                     r"(\"[^\"$`\\]*\"|'[^']*')", re.I)
    prev = None
    while prev != text:
        prev, text = text, pat.sub(lambda m: m.group(1) + "MSG ", text)
    return text


def git_subs(s):
    # Для кожного `git` у рядку: (підкоманда, решта аргументів). `-C "my dir"` — дивимось на всі токени.
    for m in re.finditer(r"(?<![\w.-])git(?:\.exe)?(?![\w-])", s):
        toks, i = re.split(SEP, s[m.end():])[0].split(), 0
        while i < len(toks):
            t = toks[i]
            if t in ("-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"):
                for x in toks[i + 1:]:
                    yield x.strip(")\"'`;{}"), toks[i + 1:]
                i += 2
            elif t.startswith("-"):
                i += 1
            else:
                yield t.strip(")\"'`;{}"), toks[i + 1:]
                break


def segments(s):
    for seg in re.split(SEP, s):
        words = []
        for t in seg.split():
            if not words and (t in ("do", "then", "else", "elif", "!", "time", "{", "(") or re.fullmatch(r"\w+=\S*", t)):
                continue
            words.append(t)
        if words:
            yield words


def push_config_problem(git, branch):
    if git("config", "--get-all", "remote.origin.push") or git("config", "--get", "remote.pushdefault") \
            or git("config", "--get", f"branch.{branch}.pushremote") or git("config", "--get", "remote.origin.mirror") \
            or git("config", "--get", "push.default") not in ("", "simple", "current") \
            or any(k.startswith("GIT_CONFIG") or k in ("GIT_DIR", "GIT_WORK_TREE") for k in os.environ):
        return "нестандартні налаштування push (remote.origin.push / mirror / push.default / pushRemote / GIT_CONFIG_*)"
    urls = git("config", "--get-all", "remote.origin.pushurl").split() or git("config", "--get-all", "remote.origin.url").split()
    for u in urls + [git("remote", "get-url", "--push", "origin")]:
        u = u.lower().replace("http://", "https://").removesuffix("/").removesuffix(".git")
        if not u.endswith(REPO):
            return f"origin (або його pushurl) вказує не на {REPO}"
    return None


def main():
    data = json.load(sys.stdin)
    cmd = str((data.get("tool_input") or {}).get("command") or "")
    cwd = data.get("cwd") if os.path.isdir(str(data.get("cwd") or "")) else ROOT
    cmd = re.sub(r"\\\r?\n|`\r?\n", " ", cmd)  # перенесення рядка (bash \, PowerShell `) — це одна команда

    text = strip_heredocs(cmd)
    # У PowerShell \" не екранує лапку — там повідомлення не вирізаємо.
    if data.get("tool_name") != "PowerShell" and '\\"' not in text:
        text = strip_messages(text)
    flat = re.sub(r"[\"'`^]", "", text)                       # g"i"t, g`i`t, g^it → git
    low = flat.lower().replace("\\", "/")                      # шляхи Windows
    low2 = re.sub(r"\\(?=\w)", "", flat).lower()               # g\it p\ush → git push
    rawlow = text.lower().replace("\\", "/")

    # 1) Захищені файли: лише читати й запускати.
    if re.search(r"disableallhooks|managed-settings", low):
        deny("Налаштування хуків змінює лише власник вручну.")
    for t in re.findall(r"\d?>{1,2}\s*([^\s&|;]+)", low):
        if PROTECTED.search(t):
            deny("Хук, скрипти згоди, .git і налаштування змінює лише власник вручну.")
    allsegs = list(segments(low)) + list(segments(low2))
    into_dir = any(w[0] in ("cd", "pushd", "set-location", "sl", "chdir") and len(w) > 1
                   and re.search(r"(^|/)(scripts|hooks|\.claude|\.git|\.config)(/|$)|[*?\[]", w[1]) for w in allsegs)
    if into_dir and re.search(r"\d?>{1,2}\s*(?!&)\S", re.sub(r"\d?>\s*(/dev/null|\$null|nul)\b", "", low)):
        deny("Перехід у захищену теку (scripts, .git, .claude) разом із записом у файл заборонений агентам.")
    for words in allsegs:
        seg = " ".join(words)
        globbed = WRITERS.match(words[0].lstrip("(&")) and any(re.search(r"[*?\[]", t) and any(fnmatch.fnmatch(p, t.lstrip("./")) or fnmatch.fnmatch(p, "*/" + t.lstrip("./"))
                                                      for p in PROTECTED_FILES) for t in words[1:])
        if not (PROTECTED.search(seg) or globbed or into_dir):
            continue
        w0 = words[0].lstrip("(&")
        ok = (w0 in READERS and not (w0 in ("node", "npm", "npx") and PROTECTED.search(seg))) or (
            re.fullmatch(r"(python[\d.]*|py)(\.exe)?", w0) and len(words) > 1
            and (re.fullmatch(r"(?:\./|\S*/)?scripts/(tg_confirm|post|notify|check_mail|bsky_search)\.py", words[1])
                 or words[1:3] == ["-m", "py_compile"])) or (
            re.fullmatch(r"(?:.*/)?git(\.exe)?", w0) and any(s in GIT_READ for s, _ in git_subs(seg)))
        if not ok or re.search(r"\s-i\b|--in-place|-delete|\s-exec|-fprint", seg):
            deny("Хук, скрипти згоди, .git, налаштування Claude/git і профілі оболонки — лише читати й запускати.")

    # Пошук тексту (`grep -rn "git push" CLAUDE.md`) — не виклик git, якщо в ньому немає підстановок.
    def code_only(s):
        return "\n".join(seg for seg in re.split(SEP, s)
                         if not (seg.split() and seg.split()[0] in TEXT_SEARCH and not re.search(r"\$\(|`", seg)))
    low, low2 = code_only(low), code_only(low2)
    isgit = re.search(r"(?<![\w-])git(\.exe)?(?![\w-])", low) or re.search(r"(?<![\w-])git(\.exe)?(?![\w-])", low2)
    subs = list(git_subs(low)) + list(git_subs(low2))
    names = {s for s, _ in subs}

    # 2) Небезпечне в git завжди.
    if re.search(r"send-pack|http-push|receive-pack|\[alias\]", low + low2) \
            or names & {"credential", "apply", "am", "send-pack", "http-push", "receive-pack", "fast-export", "bundle",
                        "clean", "filter-branch", "replace", "update-ref", "symbolic-ref"} \
            or (isgit and re.search(r"hookspath|credential\.|subtree\s+push|alias\.|--config-env|fsmonitor|sshcommand", low)):
        deny("Аліаси, git-хуки, облікові дані, apply/am/clean і низькорівневі команди заборонені для агентів.")
    for m in re.finditer(r"(?<![\w.-])git(?:\.exe)?\s(?:[^;&|\n]*?\s)?-c\s*(\S+)", flat):  # -c ≠ -C
        if not SAFE_C.fullmatch(m.group(1).lower()):
            deny(f"`git -c {m.group(1)}` заборонено агентам (дозволені лише безпечні ключі на кшталт core.quotepath).")
    for s, args in subs:
        pos_args = [a for a in args if not a.startswith("-")]
        if s == "config" and (any(a in ("--add", "--unset", "--unset-all", "--replace-all", "--rename-section",
                                        "--remove-section", "-e", "--edit", "--file", "-f", "--blob") for a in args)
                              or (len(pos_args) >= 2 and not any(a.startswith("--get") for a in args))):
            deny("Змінювати git config можна лише вручну.")
        if s == "remote" and pos_args and pos_args[0] in ("add", "set-url", "rename", "remove", "rm", "set-head",
                                                          "set-branches"):
            deny("Змінювати remote можна лише вручну.")
        if s == "branch" and any(a.startswith(("--set-upstream", "-u", "--track")) for a in args):
            deny("Змінювати upstream гілки можна лише вручну.")
        if s == "stash" and any(a in ("-u", "--include-untracked", "-a", "--all") for a in args):
            deny("`git stash -u/-a` прибирає неверсіоновані файли (зокрема хук) — лише вручну.")
    # Підстановки в аргументах git (`git pu$()sh`, `git $x`, `git {push,-f}`, `git @('pu'+'sh')`),
    # крім `-m "$(cat <<'EOF' …)"`.
    for m in re.finditer(r"(?<![\w.-])git(?:\.exe)?\s[^;&|\n]*", rawlow):
        g = re.sub(r"\$\(cat\s+<<heredoc", "", m.group(0))
        g = re.sub(r"@\{(u|upstream|push|-?\d+)\}", "", g)  # HEAD@{1}, stash@{0}, @{u}
        if re.search(r"\$|`|\{[^}]*[,.][^}]*\}|\w\{|\}\w|@\(|@\{", g):
            deny("Змінні, підстановки й розкриття ($, `, {a,b}, @(...)) у команді git заборонені агентам — пиши аргументи прямо.")
    if re.search(r"(?<![\w-])git_[a-z_]+\s*=|env:git_|\bgit_(config|dir|work_tree|exec_path|ssh|askpass|editor|pager|alternate)", low):
        deny("Змінні середовища GIT_* у команді заборонені агентам.")
    if isgit and re.search(INTERP, low):
        deny("Запуск git зсередини python -c / node -e тощо заборонений агентам.")

    # 3) GitHub і Bluesky напряму.
    gh = r"(?<![\w-])gh(\.exe)?\s"
    if re.search(gh + r"(pr\b[^;&|\n]*\bmerge|release\b[^;&|\n]*\b(create|edit|delete|upload)"
                 r"|repo\b[^;&|\n]*\b(sync|edit|delete|rename|archive)|workflow\b[^;&|\n]*\b(run|enable|disable)"
                 r"|run\b[^;&|\n]*\b(rerun|cancel|delete)|(secret|variable)\b[^;&|\n]*\b(set|delete|remove)"
                 r"|ruleset|api\b[^;&|\n]*(--method|-x)[\s=:]*(?!get\b)\w)", low) \
            or (re.search(gh + r"api\b", low) and (
                re.search(r"\s--?(raw-field|field|input|f)(?=[\s=]|\w)", low + " " + flat) and not (
                    re.search(r"\sapi\s+graphql\b", low) and not re.search(r"mutation|@|\s-F|--field", flat)))):
        deny("Змінювати репозиторій через gh / GitHub API агентам заборонено — лише git push зі згодою.")
    if re.search(r"(api|uploads)\.github\.com|github\.com/[^\s]+/git/", low) and re.search(
            r"\s(-x|--request|--json|-d|--data\S*|--form|-f|-t|--upload-file|-meth\w*|-body|-infile|-in)(?=[\s=:]|\S)"
            r"|\.(post|put|patch|delete)\(|method\s*[:=]", low):
        deny("Змінювати репозиторій через GitHub API агентам заборонено — лише git push зі згодою.")
    # API Bluesky + спосіб його викликати. Звичайний grep по коду проходить.
    if re.search(r"atproto|send_post|createrecord|putrecord|deleterecord|applywrites|createsession|bsky_app_password", low) \
            and re.search(r"\bcurl\b|\bwget\b|invoke-(restmethod|webrequest)|\birm\b|\biwr\b|" + INTERP +
                          r"|\bfetch\(|requests\.|urllib|\brequire\(|\$env|\$\{|\$bsky|printenv|(?<![\w.-])env(\s|$)|env:|environ", low):
        deny("Bluesky напряму заборонено. Пости — лише `python scripts/post.py` (питає згоди в Telegram).")

    # 4) push у будь-якому вигляді.
    pushre = r"(?<![\w./=:-])push(?![\w.-])"
    git_push = any(s == "push" or re.match(r"[$(]", s) for s, _ in subs)
    pushword = re.search(pushre, low) or re.search(pushre, low2)
    wrapped = any(w[0].lstrip("(") in WRAPPERS or w[0] == "&" or re.search(r"[$`(]", w[0])
                  for w in list(segments(low)) + list(segments(low2))) \
        or re.search(r"-encodedcommand|\|\s*(sh|bash|pwsh|powershell|iex|invoke-expression)\b|" + INTERP, low)
    if not (git_push or (pushword and wrapped)):
        sys.exit(0)  # не push — звичайна перевірка дозволів Claude Code

    m = re.fullmatch(r"\s*git\s+push(\s+(?:-u|--set-upstream))?(?:\s+origin(?:\s+([\w./-]+))?)?(?:\s+2>&1)?\s*", cmd)
    if not m:
        deny("Дозволено лише окрему команду `git push`, `git push origin <поточна гілка>` "
             "або `git push -u origin <поточна гілка>` — без прапорців, змінних, ланцюжків і обгорток.")
    if m.group(1) and not m.group(2):
        deny("Для `-u` вкажи гілку: `git push -u origin <поточна гілка>`.")

    def git(*a):
        return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=30).stdout.strip()

    branch = git("branch", "--show-current")
    if not branch:
        deny("Не на гілці (detached HEAD) — push лише вручну.")
    if m.group(2) and m.group(2) not in (branch, "HEAD"):
        deny(f"Можна пушити лише поточну гілку ({branch}).")
    problem = push_config_problem(git, branch)
    if problem:
        deny(f"Знайдено {problem} — push лише вручну.")
    up = git("rev-parse", "--abbrev-ref", "--verify", "-q", "@{u}")
    if up and up != f"origin/{branch}":
        deny(f"Гілка {branch} стежить за {up}, а не за origin/{branch} — push лише вручну.")
    if not up and not m.group(1):
        deny(f"У гілки {branch} ще немає upstream — запусти `git push -u origin {branch}`.")

    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "tg_confirm.py"), "--push", "540"],
                       cwd=cwd, input="git push на GitHub".encode("utf-8"), capture_output=True, timeout=590)
    if r.returncode == 0:
        # Поки чекали «Так», налаштування могли змінити — перевіряємо ще раз.
        problem = push_config_problem(git, branch)
        if problem:
            deny(f"Поки чекали згоди, з'явилися {problem} — push скасовано.")
        sys.exit(0)  # «Так» — далі звичайна перевірка дозволів Claude Code
    msg = r.stdout.decode("utf-8", "replace").strip()
    why = {1: "ти натиснув «Ні» в Telegram", 2: "немає відповіді в Telegram (час вийшов)",
           4: "поки чекали, змінилися коміти — запусти push ще раз"}.get(r.returncode, f"помилка запиту в Telegram: {msg}")
    deny(f"git push заблоковано: {why}.")


try:
    main()
except SystemExit:
    raise
except BaseException as e:  # fail-closed
    deny(f"Хук git_guard не зміг перевірити команду ({type(e).__name__}) — команду заблоковано.")
