<?php

/**
 * Target of the test form in sms/index.php.
 *
 * The app's Send test text button is the normal way to check the gateway
 * (see send.php); this page exists for when you are already in a browser and
 * want to type an arbitrary message. Credentials come from sms/.env — never from
 * the request — so the page cannot be used to send through someone else's
 * gateway account.
 */

require_once dirname(__DIR__) . '/lib/sms.php';

/** One SMS segment holds this many GSM-7 characters. */
const FORM_SEGMENT_CHARS = 160;

/**
 * @param array{title: string, tone: string, lines: list<string>} $result
 */
function form_page(array $result, string $backHref = '../index.php'): void
{
    $tone = $result['tone'] === 'ok'
        ? 'background:#ecfdf5;border-color:#a7f3d0;color:#065f46'
        : 'background:#fef2f2;border-color:#fecaca;color:#991b1b';

    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    echo '<title>' . htmlspecialchars($result['title'], ENT_QUOTES) . '</title></head>';
    echo '<body style="font-family:system-ui,sans-serif;max-width:38rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#18181b">';
    echo '<h1 style="font-size:1.25rem">' . htmlspecialchars($result['title'], ENT_QUOTES) . '</h1>';
    echo '<div style="border:1px solid;border-radius:.75rem;padding:1rem;' . $tone . '">';

    foreach ($result['lines'] as $line) {
        echo '<p style="margin:.25rem 0">' . htmlspecialchars($line, ENT_QUOTES) . '</p>';
    }

    echo '</div><p style="margin-top:1.5rem"><a href="' . htmlspecialchars($backHref, ENT_QUOTES) . '">&larr; Send another</a></p>';
    echo '</body></html>';
}

function form_fail(string $title, string $message, string $hint = ''): void
{
    form_page([
        'title' => $title,
        'tone' => 'error',
        'lines' => array_values(array_filter([$message, $hint])),
    ]);
    exit(1);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

$message = trim((string) ($_POST['message'] ?? ''));
$numberInput = trim((string) ($_POST['number'] ?? ''));

if ($message === '' || $numberInput === '') {
    form_fail(
        'Nothing sent',
        'Please provide both a message and a number.'
    );
}

if (strlen($message) > FORM_SEGMENT_CHARS * 2) {
    form_fail(
        'Nothing sent',
        'That message is ' . strlen($message) . ' characters; the limit is ' . FORM_SEGMENT_CHARS * 2 . '.',
        'A single SMS holds ' . FORM_SEGMENT_CHARS . ' characters.'
    );
}

$number = sms_normalize_ph_mobile($numberInput);
if ($number === null) {
    form_fail(
        'Nothing sent',
        'That is not a Philippine mobile number: ' . $numberInput,
        'Use the form 0917 123 4567, +639171234567, or 9171234567.'
    );
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

$result = sms_send($number, $message);

if (!$result['ok']) {
    $classified = sms_classify_error($result['error']);
    form_fail('Sending failed', $result['error'], $classified['hint']);
}

$segments = (int) max(1, ceil(strlen($message) / FORM_SEGMENT_CHARS));

form_page([
    'title' => 'Test text sent',
    'tone' => 'ok',
    'lines' => array_values(array_filter([
        'To ' . sms_mask_number($number) . '.',
        'Gateway id: ' . $result['id'],
        'State: ' . ($result['state'] ?? 'unknown'),
        $segments > 1 ? "Sent as {$segments} SMS parts." : null,
        $result['state'] !== null && !in_array(strtolower($result['state']), ['sent', 'delivered'], true)
            ? 'Queued on the gateway — the text leaves your phone once the SMS Gateway app is online.'
            : null,
    ])),
]);
