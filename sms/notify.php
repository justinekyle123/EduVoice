<?php

/**
 * Task reminder cron.
 *
 * Every run asks the EduVoice app which tasks have just come due for students
 * who saved a mobile number (GET /api/tasks/reminders), texts each one through
 * the SMS Gateway app running on this phone, and then tells the app the message
 * went out so it is never sent twice.
 *
 * The SMS itself is composed by the app, not here — this script is only the
 * transport that has to be PHP (the gateway ships a PHP client and nothing else).
 *
 * Usage:
 *   php sms/notify.php                  send the reminders that are due now
 *   php sms/notify.php --dry-run        list them without sending anything
 *   php sms/notify.php --limit=5        send at most five in one run
 *
 * Schedule it every few minutes (see sms/README.md). With no arguments and
 * nothing due, it is silent and exits 0.
 */

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/sms.php';

/** Only one run at a time, so an overlapping cron can't text anyone twice. */
const NOTIFY_LOCK_FILE = 'eduvoice-sms-notify.lock';

function notify_log(string $message): void
{
    echo '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
}

function notify_usage(): void
{
    echo 'Usage: php sms/notify.php [--dry-run] [--limit=N] [--help]' . PHP_EOL;
}

/**
 * @param  list<string> $argv
 * @return array{dryRun: bool, limit: int, help: bool, error: string}
 */
function notify_parse_args(array $argv): array
{
    $options = ['dryRun' => false, 'limit' => 0, 'help' => false, 'error' => ''];

    foreach (array_slice($argv, 1) as $arg) {
        if ($arg === '--dry-run') {
            $options['dryRun'] = true;
        } elseif ($arg === '--help' || $arg === '-h') {
            $options['help'] = true;
        } elseif (str_starts_with($arg, '--limit=')) {
            $limit = (int) substr($arg, strlen('--limit='));
            if ($limit <= 0) {
                $options['error'] = '--limit must be a positive number';
            }
            $options['limit'] = $limit;
        } else {
            $options['error'] = "Unknown option: {$arg}";
        }
    }

    return $options;
}

/**
 * @return array{reminders: list<array<string, mixed>>, error: string}
 */
function notify_fetch(string $baseUrl, string $token, int $tzOffsetMinutes): array
{
    $url = $baseUrl . '/api/tasks/reminders?tzOffsetMinutes=' . $tzOffsetMinutes;
    $response = sms_http_json('GET', $url, null, ['Authorization: Bearer ' . $token]);

    if (!$response['ok']) {
        $detail = $response['json']['error'] ?? trim($response['body']);
        return [
            'reminders' => [],
            'error' => "could not reach {$url} ({$response['error']}"
                . ($detail !== '' ? ": {$detail}" : '') . ')',
        ];
    }

    $reminders = $response['json']['reminders'] ?? [];
    if (!is_array($reminders)) {
        return ['reminders' => [], 'error' => 'the app returned an unexpected payload'];
    }

    return ['reminders' => array_values($reminders), 'error' => ''];
}

/** Tell the app a reminder was handed to the gateway. */
function notify_ack(string $baseUrl, string $token, string $taskId): bool
{
    $response = sms_http_json(
        'POST',
        $baseUrl . '/api/tasks/reminders',
        ['taskIds' => [$taskId]],
        ['Authorization: Bearer ' . $token]
    );

    return $response['ok'];
}

function notify_main(array $argv): int
{
    $options = notify_parse_args($argv);
    if ($options['help']) {
        notify_usage();
        return 0;
    }
    if ($options['error'] !== '') {
        fwrite(STDERR, $options['error'] . PHP_EOL);
        notify_usage();
        return 2;
    }

    $baseUrl = rtrim(sms_env('EDUVOICE_URL', 'http://localhost:3000'), '/');
    $token = sms_env('TASK_REMINDER_TOKEN');
    if ($token === '') {
        fwrite(
            STDERR,
            'TASK_REMINDER_TOKEN is missing from sms/.env — it must match the same '
            . 'variable in the app\'s .env. See sms/README.md.' . PHP_EOL
        );
        return 2;
    }

    // Minutes behind UTC, the convention the app's due-date parsing uses.
    $tzOffsetMinutes = -intdiv((int) date('Z'), 60);

    $lock = fopen(sys_get_temp_dir() . DIRECTORY_SEPARATOR . NOTIFY_LOCK_FILE, 'c');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
        notify_log('Another reminder run is still going — skipping this one.');
        return 0;
    }

    try {
        $fetched = notify_fetch($baseUrl, $token, $tzOffsetMinutes);
        if ($fetched['error'] !== '') {
            notify_log('ERROR: ' . $fetched['error']);
            return 1;
        }

        $reminders = $fetched['reminders'];
        if ($options['limit'] > 0) {
            $reminders = array_slice($reminders, 0, $options['limit']);
        }
        if ($reminders === []) {
            if ($options['dryRun']) {
                notify_log('Nothing due right now.');
            }
            return 0;
        }

        notify_log(sprintf(
            '%d task(s) due — %s.',
            count($reminders),
            $options['dryRun'] ? 'dry run, sending nothing' : 'sending'
        ));

        $sent = 0;
        $failed = 0;

        foreach ($reminders as $reminder) {
            $taskId = (string) ($reminder['taskId'] ?? '');
            $phone = (string) ($reminder['phone'] ?? '');
            $title = (string) ($reminder['title'] ?? '');
            $message = (string) ($reminder['message'] ?? '');

            if ($taskId === '' || $phone === '' || $message === '') {
                notify_log("SKIP  a reminder arrived without a task, number, or message: {$title}");
                $failed++;
                continue;
            }

            if ($options['dryRun']) {
                notify_log(sprintf(
                    'DRY   %s  "%s" → %s',
                    sms_mask_number($phone),
                    $title,
                    $message
                ));
                $sent++;
                continue;
            }

            $result = sms_send($phone, $message);
            if (!$result['ok']) {
                // Left unacknowledged on purpose: the next run tries again.
                notify_log(sprintf('FAIL  %s  "%s" — %s', sms_mask_number($phone), $title, $result['error']));
                $failed++;
                continue;
            }

            notify_log(sprintf(
                'SENT  %s  "%s"  id=%s state=%s',
                sms_mask_number($phone),
                $title,
                (string) $result['id'],
                $result['state'] ?? 'unknown'
            ));
            $sent++;

            if (!notify_ack($baseUrl, $token, $taskId)) {
                // Already delivered, so this is not worth re-sending — but the
                // app will offer it again next run, so say so loudly.
                notify_log("WARN  could not record the reminder for task {$taskId} — it may be sent twice.");
            }
        }

        notify_log(sprintf(
            'Done: %d %s, %d failed.',
            $sent,
            $options['dryRun'] ? 'would send' : 'sent',
            $failed
        ));

        return $failed > 0 && $sent === 0 ? 1 : 0;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

exit(notify_main($argv));
