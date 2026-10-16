<?php

/**
 * JSON send endpoint.
 *
 * This is what the app's "Send test text" button calls: one message, one
 * recipient, an answer the UI can show. It is deliberately separate from
 * notify.php (the cron) — same library underneath, different caller — so a test
 * from the app proves the path the real reminders use.
 *
 *   POST /send.php
 *   Authorization: Bearer <TASK_REMINDER_TOKEN>       (or X-EduVoice-Token)
 *   Content-Type: application/json
 *
 *   { "number": "0917 123 4567", "message": "..." }
 *
 *   → 200 { "ok": true,  "id": "…", "state": "Pending", "to": "+639171234567" }
 *   → 4xx { "ok": false, "code": "invalid_number", "error": "…", "hint": "…" }
 *
 * Every failure answers with the same JSON shape, so the app never has to guess
 * what went wrong. `code` is what it switches on; `error` and `hint` are what the
 * student reads.
 */

require_once __DIR__ . '/lib/sms.php';

// Any warning printed into the body would break the caller's JSON parsing, so
// the output is buffered and thrown away whenever a response is written.
ob_start();
ini_set('display_errors', '0');
ini_set('log_errors', '1');

/** One SMS segment holds this many GSM-7 characters; a longer text costs more. */
const SEND_SEGMENT_CHARS = 160;

/** Refuse anything past this rather than silently billing four texts. */
const SEND_MAX_MESSAGE = 320;

/**
 * @param array<string, mixed> $payload
 */
function send_respond(int $status, array $payload): never
{
    if (ob_get_level() > 0) {
        ob_clean();
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** @param array<string, mixed> $payload */
function send_fail(int $status, string $code, string $error, string $hint = ''): never
{
    send_respond($status, array_filter([
        'ok' => false,
        'code' => $code,
        'error' => $error,
        'hint' => $hint,
    ], static fn ($value) => $value !== ''));
}

// A fatal error (a missing extension, a broken include) must still answer in
// JSON, otherwise the app reports a parse failure instead of the real cause.
register_shutdown_function(static function (): void {
    $error = error_get_last();
    $fatal = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if ($error === null || !in_array($error['type'], $fatal, true)) {
        return;
    }

    send_fail(
        500,
        'server_error',
        'The SMS service stopped with a fatal error: ' . $error['message'],
        'Check the PHP error log for sms/send.php — this is a problem in the sms folder, not with your phone.'
    );
});

// ---------------------------------------------------------------------------
// Method
// ---------------------------------------------------------------------------

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'OPTIONS') {
    header('Allow: POST');
    send_respond(204, []);
}
if ($method !== 'POST') {
    send_fail(
        405,
        'method_not_allowed',
        "This endpoint only accepts POST, got {$method}.",
        'The app posts to it; a browser opening it directly will always show this.'
    );
}

// ---------------------------------------------------------------------------
// Authentication
//
// It is reached from the app over plain HTTP on the same machine, so it is
// guarded by the same shared secret the reminder cron uses. Without that secret
// anyone on the network could send SMS through your phone.
// ---------------------------------------------------------------------------

$expected = sms_env('TASK_REMINDER_TOKEN');
if ($expected === '') {
    send_fail(
        500,
        'token_not_configured',
        'TASK_REMINDER_TOKEN is not set in sms/.env.',
        'Generate one and put the same value in the app\'s .env (see sms/.env.example).'
    );
}

$header = (string) (
    $_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? ''
);
if (str_starts_with($header, 'Bearer ')) {
    $header = trim(substr($header, 7));
}
if ($header === '') {
    $header = trim((string) ($_SERVER['HTTP_X_EDUVOICE_TOKEN'] ?? ''));
}

if ($header === '' || !hash_equals($expected, $header)) {
    send_fail(
        401,
        'unauthorized',
        'Missing or wrong token.',
        'TASK_REMINDER_TOKEN in the app\'s .env must match the one in sms/.env.'
    );
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

$raw = (string) file_get_contents('php://input');
$payload = json_decode($raw, true);
if (!is_array($payload)) {
    send_fail(
        400,
        'invalid_request',
        'The request body must be JSON like {"number":"0917…","message":"…"}.',
        $raw === '' ? 'Nothing was posted.' : 'The body could not be parsed as JSON.'
    );
}

$message = trim((string) ($payload['message'] ?? ''));
if ($message === '') {
    send_fail(400, 'invalid_request', 'The message cannot be empty.');
}

if (strlen($message) > SEND_MAX_MESSAGE) {
    send_fail(
        400,
        'message_too_long',
        'The message is ' . strlen($message) . ' characters; the limit is ' . SEND_MAX_MESSAGE . '.',
        'A single SMS holds ' . SEND_SEGMENT_CHARS . ' characters.'
    );
}

$number = sms_normalize_ph_mobile((string) ($payload['number'] ?? ''));
if ($number === null) {
    send_fail(
        400,
        'invalid_number',
        'That is not a Philippine mobile number: ' . trim((string) ($payload['number'] ?? '')) . '.',
        'Use the form 0917 123 4567, +639171234567, or 9171234567.'
    );
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

$result = sms_send($number, $message);

if (!$result['ok']) {
    $classified = sms_classify_error($result['error']);
    send_fail(502, $classified['code'], $result['error'], $classified['hint']);
}

send_respond(200, [
    'ok' => true,
    'to' => $number,
    'id' => $result['id'],
    // Pending means the phone has not collected it yet: the gateway took it, but
    // nothing leaves the phone until the app is online.
    'state' => $result['state'],
    'segments' => (int) max(1, ceil(strlen($message) / SEND_SEGMENT_CHARS)),
]);
