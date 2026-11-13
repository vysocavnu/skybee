# Пошук постів у Bluesky і згадок акаунта Skybee.
#   python scripts/bsky_search.py search "запит" [кількість]
#   python scripts/bsky_search.py mentions [кількість]
import os, sys
from atproto import Client

sys.stdout.reconfigure(encoding="utf-8")
c = Client()
c.login(os.environ["BSKY_HANDLE"], os.environ["BSKY_APP_PASSWORD"])
mode = sys.argv[1] if len(sys.argv) > 1 else "search"

def show(author, text, likes, replies, uri):
    print(f"@{author} | ❤{likes} 💬{replies} | {uri}")
    print(" ".join((text or "").split())[:500])
    print("---")

if mode == "mentions":
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    res = c.app.bsky.notification.list_notifications(params={"limit": limit})
    for n in res.notifications:
        if n.reason in ("mention", "reply", "quote"):
            show(n.author.handle, getattr(n.record, "text", ""), 0, 0, n.uri)
else:
    q = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    res = c.app.bsky.feed.search_posts(params={"q": q, "limit": min(limit, 100), "sort": "latest"})
    for p in res.posts:
        show(p.author.handle, getattr(p.record, "text", ""), p.like_count or 0, p.reply_count or 0, p.uri)
