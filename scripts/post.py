# Публікує пост у Bluesky — лише після твоєї ✅ у Discord (scripts/dc_confirm.py).
# Текст — зі stdin, щоб у ньому не виконувались $(...) і `...`:
#   python scripts/post.py <<'EOF'
#   текст поста
#   EOF
import os, sys, subprocess

sys.stdout.reconfigure(encoding="utf-8")
text = (sys.argv[1] if len(sys.argv) > 1 else sys.stdin.buffer.read().decode("utf-8", "replace")).strip()
if not text:
    print("error: empty post")
    sys.exit(3)
if len(text) > 300:
    print(f"error: post is {len(text)} chars, Bluesky allows 300")
    sys.exit(3)

here = os.path.dirname(os.path.abspath(__file__))
r = subprocess.run([sys.executable, os.path.join(here, "dc_confirm.py"), "540"],
                   input=("Опублікувати в Bluesky від @" + os.environ.get("BSKY_HANDLE", "?")
                          + ":\n\n" + text).encode("utf-8"), capture_output=True)
if r.returncode != 0:
    why = {1: "скасовано в Discord", 2: "немає відповіді в Discord"}.get(
        r.returncode, "помилка запиту в Discord: " + r.stdout.decode("utf-8", "replace").strip())
    print("not posted:", why)
    sys.exit(r.returncode or 3)

from atproto import Client

c = Client()
c.login(os.environ["BSKY_HANDLE"], os.environ["BSKY_APP_PASSWORD"])
c.send_post(text)
print("ok")
