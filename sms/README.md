# SMS reminders (EduVoice → the student's phone)

Students save a mobile number on the **Tasks** page and get one text the moment a
task's day and time arrives. This folder is the part that talks to the phone.

It is PHP because it has to be: the SMS Gateway app has a PHP client
(`capcom6/android-sms-gateway`) and no Node one. Everything else — which tasks are
due, what the message says — stays in the app, so this folder is only the
transport:

```
  phone (SMS Gateway app)                EduVoice (Next.js)
        ▲                                      │
        │ ① POST /message                      │ GET /api/tasks/reminders
        │    (gateway cloud API)               │   → [{ phone, message, taskId }]
        │                                      │ POST /api/tasks/reminders
  sms/notify.php ────② which tasks are due?───►│   → "handed to the gateway"
  (this folder, run by cron)                   │
                                               │ (the student's due tasks live
                                               │  in Postgres behind the app)
```

| File | What it is |
| --- | --- |
| `notify.php` | The cron job. Fetches what is due, sends it, marks it sent. |
| `notify.cmd` | The Windows wrapper the scheduled task runs, so its command has no nested quoting and every run is logged to `sms/notify.log`. |
| `send.php` | JSON send endpoint — the app's **Send test text** button posts here. |
| `serve.php` | Router for PHP's built-in server: serves the entry points, 404s everything else. |
| `.htaccess` | The same lockdown for Apache/XAMPP. |
| `lib/env.php` | Reads `sms/.env` (no extra dependency). |
| `lib/sms.php` | Gateway client, number normalising, error classification. |
| `lib/http.php` | Tiny cURL JSON helper for calling the app. |
| `index.php`, `function/sms.php` | A manual "send a test text" form in the browser. |
| `app-release.apk` | The SMS Gateway for Android app to install on the phone. |
| `vendor/` | Composer dependencies, committed so a fresh clone runs as-is. |

## Setup

### 1. The phone

1. Install `app-release.apk` on the phone that will do the sending.
2. Sign in to your account in the app and leave it running. The phone needs
   internet; messages wait in the queue while it is offline.
3. Open the app's **Cloud server** screen and copy the **username** and
   **password** — that is what goes in `.env` below.

### 2. Credentials

```bash
cp sms/.env.example sms/.env
```

Fill in `SMS_GATEWAY_USERNAME` and `SMS_GATEWAY_PASSWORD`. For local testing the
notifier calls the app on `http://localhost:3000` (the default in `EDUVOICE_URL`);
point it at your deployment URL when the app runs somewhere else.

Then set `TASK_REMINDER_TOKEN` to a secret you generate:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put **the same value** in the app's own `.env` at the repository root — the
notifier uses it to authenticate to `/api/tasks/reminders`, which has no Clerk
session to check. (`.env` files in both places are git-ignored.)

### 3. Serve the folder (needed by the app's test button)

The Tasks page has a **Send test text** button that posts to `sms/send.php`, so
that endpoint has to be reachable over HTTP. The built-in server with the router
is the shortest path — from the project root:

```bash
php -S 127.0.0.1:8081 -t sms sms/serve.php
```

Then set `SMS_SEND_URL=http://127.0.0.1:8081/send.php` in the app's `.env` (it is
the default, so usually nothing to do) and restart `npm run dev` if you changed
it.

**Always pass the router.** `php -S 127.0.0.1:8081 -t sms` on its own publishes
the whole folder, and `http://127.0.0.1:8081/.env` would hand out your gateway
username and password. `serve.php` allows only `index.php`, `function/sms.php`
and `send.php`, and answers `404` for `.env`, `vendor/`, `lib/` and the APK.

With XAMPP/Apache, point a virtual host (or a folder under `htdocs`) at this
directory instead; `sms/.htaccess` denies the same files, but only if
`AllowOverride` is on for that path. Use `http://localhost/sms/send.php` as
`SMS_SEND_URL` in that case.

### 4. Try it

**From the app.** Tasks page → save your mobile number → **Send test text**. You
get one real SMS, and the panel below the button reports the gateway's id and
state, or exactly what went wrong.

**From the command line.** With `npm run dev` running in another terminal:

```bash
php sms/notify.php --dry-run   # what would be sent right now (sends nothing)
php sms/notify.php             # actually send
php sms/notify.php --help
```

Nothing is due yet unless a task's due time has passed and its student saved a
number, so make one: Tasks page → save your number → add a task due a minute ago.

**From the browser form.** With the folder served (step 3):

```
http://127.0.0.1:8081/index.php
```

**Straight at the endpoint** (the same call the button makes):

```bash
curl -s -X POST http://127.0.0.1:8081/send.php \
  -H "Authorization: Bearer $TASK_REMINDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"number":"0917 123 4567","message":"EduVoice test"}'
```

### 5. Schedule it

**Nothing texts anyone until something runs `notify.php` on a timer** — a task
whose due time arrives simply sits in the queue until a run picks it up. Every
minute is what this install uses, so the text lands within a minute of the due
moment; every five (`/MO 5`) is plenty if you would rather it ran less often.

Windows (Task Scheduler; adjust the paths to your install). Schedule the
`sms/notify.cmd` wrapper rather than `php.exe` itself: it keeps the scheduled
command to a single path with no nested quoting, and appends whatever a run has
to say to `sms/notify.log`.

```bat
schtasks /Create /TN "EduVoice SMS reminders" /SC MINUTE /MO 1 /F ^
  /TR "C:\Development\EduVoice\sms\notify.cmd"
```

A task created that way only starts on mains power and is killed if the laptop
unplugs, which would silently drop reminders, so relax both settings:

```powershell
$s = (Get-ScheduledTask -TaskName "EduVoice SMS reminders").Settings
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries = $false
$s.MultipleInstances = "IgnoreNew"
Set-ScheduledTask -TaskName "EduVoice SMS reminders" -Settings $s
```

Then you can watch it, pause it, or drop it again:

```bat
schtasks /Query  /TN "EduVoice SMS reminders" /FO LIST /V
schtasks /Change /TN "EduVoice SMS reminders" /DISABLE
schtasks /Change /TN "EduVoice SMS reminders" /ENABLE
schtasks /Delete /TN "EduVoice SMS reminders" /F
```

The `Query` output is how you check the timer is alive: **Last Run Time** should
be within the last minute, and **Last Result** `0` is a clean run.

Linux/macOS (crontab):

```cron
* * * * * /usr/bin/php /path/to/EduVoice/sms/notify.php >> /var/log/eduvoice-sms.log 2>&1
```

A run with nothing due prints nothing and exits `0`; a run that sends writes
`SENT …` per text, and a failure writes `FAIL …` or `ERROR …` and exits `1`. On
Windows all of that goes to `sms/notify.log`. Only one run happens at a time (a
lock file), so an overlap cannot text anyone twice. The Windows task runs only
while you are signed in, which is fine: the notifier has no database of its own
and needs the app reachable at `EDUVOICE_URL` on this machine.

## What gets sent, and when

* One SMS per task, at its due day and time — no reminder before it.
* Only tasks that are **not** ticked off, that the student has not already been
  texted about, and that carry a saved mobile number.
* The app composes the text, e.g.
  `EduVoice: “Review chapter 4” is due now (Oct 16, 5:00 PM). Open EduVoice to tick it off.`
* The due time is rendered in the clock of the machine running `notify.php`,
  which is normally the student's own — that is how the due date was set. That
  clock is read from the machine itself (`ActiveTimeBias` in the registry on
  Windows, `date +%z` elsewhere), **not** from php.ini: a stock XAMPP ships
  `date.timezone=Europe/Berlin`, which would put the wrong hour in every text.
  `NOTIFY_TZ_OFFSET_MINUTES` in `sms/.env` overrides the detection.
* Anything more than **24 hours** overdue is skipped, so a notifier that was off
  for a few days does not fire off a backlog of stale deadlines. Up to **50**
  reminders go out per run.

A reminder is only marked as sent *after* the gateway accepts it. If the phone
was offline or the gateway refused, the task stays queued and the next run tries
again — which is why the app offers the same task again if the second call ever
fails (it then logs `WARN … may be sent twice`).

## When no reminder arrives

The test button and the timer are separate paths: the button sends at once, a due
task waits for the scheduler. So check them in this order.

1. **Is anything queued?** `php sms/notify.php --dry-run` prints the clock it is
   using and one `DRY …` line per task that is due, sending nothing.
2. **Is the timer running it?** `schtasks /Query /TN "EduVoice SMS reminders" /FO LIST /V`
   — a **Last Run Time** older than a minute, or a non-zero **Last Result**, means
   the task itself is the problem (`267011` only means it has not run yet).
3. **Did the run complain?** `sms/notify.log` names it: `ERROR … could not reach
   http://localhost:3000/…` means the app is not running on this machine, and
   `FAIL …` means the gateway refused the send — that task stays queued, and the
   next run tries it again.
4. **Is the task even eligible?** It has to be unticked, carry a due time, belong
   to a student with a saved mobile number, and be less than 24 hours overdue.
   Anything older is skipped on purpose, as is anything the phone already got.

## When the app reports a failure

The button turns the endpoint's `code` into something you can act on:

| What the app says | Code | What it means |
| --- | --- | --- |
| Save your mobile number first | `no_number` | No number on the account yet — save one on the Tasks page. |
| Could not reach the SMS service at … | `unreachable` | The PHP server is not running, or `SMS_SEND_URL` points somewhere else. Start it with the router (step 3). |
| … did not answer within 20 seconds | `timeout` | The PHP server is up but the gateway call hung — usually no internet on this machine. |
| … answered 404/500 with something that is not JSON | `bad_response` | `SMS_SEND_URL` is wrong (a wrong route answers with an HTML error page). The hint shows the first line of it. |
| TASK_REMINDER_TOKEN is not set/mismatched | `token_not_configured`, `unauthorized` | The app's `.env` and `sms/.env` must hold the **same** token. |
| Fill SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD in sms/.env | `credentials_missing` | Neither is set. Copy both from the SMS Gateway app's cloud account screen. |
| The gateway refused the login | `gateway_rejected` | The credentials are wrong or were reset in the app. |
| Queued on the gateway (state: Pending) | — | Sent to the gateway fine, but the phone has not collected it: open the SMS Gateway app and check signal/load. Not an error. |
| Your phone could not send the text | `gateway_failed` | The phone tried and failed — SIM, signal or load. |
| The SMS service stopped with a fatal error | `server_error` | A PHP fatal in the endpoint; the PHP error log names it. |

## Security

* `sms/.env` holds the gateway credentials; it is git-ignored. **The credentials
  that used to be hardcoded in `index.php` were committed to the repository at
  some point — rotate the gateway password from the app's account screen if that
  history is public.** Anyone with them can send SMS through your phone.
* Serving this folder is the one operation that can expose those credentials, so
  `sms/serve.php` (built-in server) and `sms/.htaccess` (Apache) refuse `.env`,
  `vendor/`, `lib/` and the APK. Bind the built-in server to `127.0.0.1` so it is
  not reachable from the campus network.
* `send.php` requires the shared token and accepts one recipient per request, so
  a leaked URL alone cannot be used to send SMS. Behind a shared network it is
  still worth keeping the endpoint on `127.0.0.1`.
* `/api/tasks/reminders` is closed unless `TASK_REMINDER_TOKEN` is set, and it
  only ever sends numbers and message bodies for tasks that are due. Leave the
  variable empty to disable it (it then answers `401` to everything).
