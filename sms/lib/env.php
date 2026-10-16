<?php

/**
 * Tiny .env reader for the SMS folder.
 *
 * The Next.js app keeps its own `.env` at the repository root; this one holds
 * only what the notifier and the gateway client need, so the credentials for the
 * phone's SMS Gateway app never have to be typed into a PHP file (or committed).
 * Values already exported in the environment win, so a run can be pointed at
 * another gateway with `SMS_GATEWAY_USERNAME=… php sms/notify.php`.
 */

function sms_env_load(string $path): void
{
    if (!is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') {
            continue;
        }
        if (str_starts_with($line, 'export ')) {
            $line = trim(substr($line, 7));
        }

        $equals = strpos($line, '=');
        if ($equals === false) {
            continue;
        }

        $key = trim(substr($line, 0, $equals));
        $value = trim(substr($line, $equals + 1));

        // Strip one layer of matching quotes.
        $length = strlen($value);
        if ($length >= 2) {
            $first = $value[0];
            if (($first === '"' || $first === "'") && $value[$length - 1] === $first) {
                $value = substr($value, 1, -1);
            }
        }

        if ($key !== '' && getenv($key) === false) {
            putenv("{$key}={$value}");
        }
    }
}

/** Read a setting, falling back to `$default` when it is unset or empty. */
function sms_env(string $key, string $default = ''): string
{
    $value = getenv($key);
    if ($value === false || trim($value) === '') {
        return $default;
    }
    return trim($value);
}

// Loaded on include, so every entry point (cron, test form, CLI check) sees the
// same credentials without repeating the require.
sms_env_load(dirname(__DIR__) . '/.env');
