# Ukr.net через IMAP. Нужен пароль для внешней программы: ukr.net → меню → «Керування IMAP-доступом».
import os, imaplib, email
from email.header import decode_header, make_header

m = imaplib.IMAP4_SSL(os.environ.get("MAIL_IMAP", "imap.ukr.net"), 993)
m.login(os.environ["MAIL_USER"], os.environ["MAIL_APP_PASSWORD"])
m.select("INBOX", readonly=True)  # письма остаются непрочитанными
_, ids = m.search(None, "UNSEEN")
for i in ids[0].split()[-20:]:
    _, data = m.fetch(i, "(BODY.PEEK[])")
    msg = email.message_from_bytes(data[0][1])
    body = ""
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            body = part.get_payload(decode=True).decode(errors="ignore")
            break
    print("FROM:", make_header(decode_header(msg.get("From", ""))))
    print("SUBJ:", make_header(decode_header(msg.get("Subject", ""))))
    print(" ".join(body.split())[:300])
    print("---")
m.logout()
