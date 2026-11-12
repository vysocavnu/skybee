// Skybee — errors in plain Ukrainian: what happened, what to do, and the technical code in brackets
// (so a screenshot of the message is enough to know the cause). No imports: every module can use it.

const BY_CODE = {
  RateLimitExceeded: "Забагато запитів підряд — Bluesky просить зачекати. Спробуй за хвилину-дві",
  ExpiredToken: "Сесія застаріла. Онови сторінку; якщо не допоможе — увійди знову",
  InvalidToken: "Сесія недійсна — увійди в акаунт знову",
  AuthenticationRequired: "Потрібно увійти в акаунт (або пароль неправильний)",
  AuthMissing: "Потрібно увійти в акаунт",
  NoSession: "Щоб це зробити, увійди в акаунт",
  AccountTakedown: "Акаунт заблоковано модерацією Bluesky",
  AccountDeactivated: "Акаунт деактивовано",
  AccountNotFound: "Такого акаунта немає",
  BlockedActor: "Ви заблокували цей акаунт",
  BlockedByActor: "Цей акаунт заблокував вас",
  NotFound: "Не знайдено — можливо, це видалили",
  RecordNotFound: "Запис не знайдено — можливо, його видалили",
  InvalidSwap: "Дані щойно змінилися в іншому місці. Онови сторінку й спробуй ще раз",
  BlobTooLarge: "Файл завеликий для Bluesky",
  InvalidMimeType: "Такий тип файлу Bluesky не приймає",
  PayloadTooLarge: "Завеликий файл чи запит",
  UpstreamFailure: "Сервіс, до якого звертається Bluesky (фід, чат чи модерація), зараз не відповідає. Спробуй пізніше",
  UpstreamTimeout: "Сервіс, до якого звертається Bluesky, не встиг відповісти. Спробуй ще раз",
  MethodNotImplemented: "Сервер акаунта цього не вміє (можливо, застаріла версія PDS)",
  InvalidHandle: "Такий нік не підходить",
  HandleNotAvailable: "Цей нік уже зайнятий",
  UnknownFeed: "Такого фіда вже немає",
  InvalidConvo: "Цього чату вже немає",
  MessagesDisabled: "Ця людина не приймає повідомлень",
  NotFollowedBySender: "Ця людина приймає повідомлення лише від тих, за ким стежить",
  RecipientNotFound: "Отримувача не знайдено",
};
const BY_STATUS = {
  400: "Сервер не прийняв запит", 401: "Потрібно увійти знову", 403: "Немає доступу до цього", 404: "Не знайдено",
  408: "Сервер не дочекався запиту", 409: "Конфлікт: дані змінилися — онови сторінку", 413: "Завеликий файл чи запит",
  415: "Такий тип файлу не підтримується", 429: "Забагато запитів — зачекай хвилинку",
  500: "Помилка на сервері", 501: "Сервер цього не вміє", 502: "Сервер тимчасово недоступний — спробуй трохи згодом",
  503: "Сервер тимчасово недоступний — спробуй трохи згодом", 504: "Сервер не встиг відповісти — спробуй ще раз",
};
const ukrainian = (s) => /[а-щьюяєіїґ]/i.test(s);

export function errText(e) {
  if (!e) return "Невідома помилка";
  if (typeof e === "string") e = { message: e };
  const msg = String(e.message || "").trim(), code = e.code || e.error || "", status = e.status;
  // no connection at all: the request never reached a server
  if (/Failed to fetch|NetworkError|Load failed|network error|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|fetch failed/i.test(msg)
      || (e.name === "TypeError" && /fetch|network/i.test(msg)))
    return navigator.onLine === false
      ? "Немає інтернету. Перевір з'єднання й спробуй ще раз (код: offline)"
      : "Не вдалося з'єднатися з сервером: зник інтернет, сервер недоступний, або з'єднання блокує VPN, фаєрвол чи блокувальник реклами (код: network)";
  if (e.name === "AbortError" || e.name === "TimeoutError" || /aborted|timed? ?out/i.test(msg))
    return "Запит перервано: він тривав задовго або його скасовано. Спробуй ще раз (код: timeout)";
  if (e.name === "QuotaExceededError") return "На пристрої закінчилося місце для даних Skybee (код: quota)";
  if (e.name === "SyntaxError" && /JSON|Unexpected token/i.test(msg)) return "Сервер відповів чимось незрозумілим — можливо, він зараз оновлюється. Спробуй пізніше (код: bad-response)";
  const tail = [code, status].filter(Boolean).join(", ");
  const withCode = (t) => tail ? `${t} (код: ${tail})` : t;
  if (BY_CODE[code]) return withCode(BY_CODE[code]);
  if (msg && ukrainian(msg) && !/^Помилка \d+$/.test(msg)) return withCode(msg); // our own explanations are already in Ukrainian
  const base = BY_STATUS[status] || (status >= 500 ? "Сервер тимчасово не працює" : status ? "Сервер повернув помилку" : "");
  if (base && msg && !/^Помилка \d+$/.test(msg) && msg !== code) return withCode(`${base}: ${msg}`);
  if (base) return withCode(base);
  return withCode(msg || "Щось пішло не так");
}
