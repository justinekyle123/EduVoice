<?php

/**
 * Sending side of the SMS folder.
 *
 * Wraps the `capcom6/android-sms-gateway` client (see sms/composer.json) with the
 * two things every caller needs: credentials read from `.env` instead of being
 * typed into a page, and Philippine mobile numbers normalised to the single form
 * the gateway accepts.
 */

require_once __DIR__ . '/env.php';
require_once dirname(__DIR__) . '/vendor/autoload.php';

use AndroidSmsGateway\Client;
use AndroidSmsGateway\Domain\Message;

/** A PH mobile number without the country code: 9 followed by nine digits. */
const SMS_PH_MOBILE_PATTERN = '/^9\d{9}$/';

/**
 * Canonical E.164 form of a Philippine mobile number, or null when the input is
 * not one. Mirrors src/features/tasks/lib/phone.ts, so a number saved in the app
 * and one typed into the test form are stored and dialed identically.
 */
function sms_normalize_ph_mobile(string $input): ?string
{
    $digits = preg_replace('/[\s\-().]/', '', trim($input)) ?? '';
    if (str_starts_with($digits, '+')) {
        $digits = substr($digits, 1);
    }
    if ($digits === '' || preg_match('/^\d+$/', $digits) !== 1) {
        return null;
    }

    // International prefix, dialed or written.
    if (str_starts_with($digits, '00')) {
        $digits = substr($digits, 2);
    }
    if (str_starts_with($digits, '63')) {
        $digits = substr($digits, 2);
    }

    // "0917…" and a doubly-prefixed "+630917…" both land here.
    $digits = ltrim($digits, '0');

    return preg_match(SMS_PH_MOBILE_PATTERN, $digits) === 1 ? '+63' . $digits : null;
}

/** "+639171234567" → "+63917•••4567", for logs that may be kept or shared. */
function sms_mask_number(string $number): string
{
    if (strlen($number) <= 8) {
        return $number;
    }
    return substr($number, 0, 7) . '•••' . substr($number, -4);
}

/**
 * A gateway client built from `.env`.
 *
 * @throws RuntimeException when the credentials are missing.
 */
function sms_gateway_client(): Client
{
    $username = sms_env('SMS_GATEWAY_USERNAME');
    $password = sms_env('SMS_GATEWAY_PASSWORD');

    if ($username === '' || $password === '') {
        throw new RuntimeException(
            'SMS gateway credentials are missing. Copy sms/.env.example to sms/.env '
            . 'and fill in the username and password of the SMS Gateway app account.'
        );
    }

    return new Client($username, $password, sms_env('SMS_GATEWAY_URL', Client::DEFAULT_URL));
}

/**
 * Turn a client-library error message into a code the app can act on, plus a
 * one-line hint for the common causes. The library only hands back a message
 * string, so this is a small mapping rather than an exception hierarchy.
 *
 * @return array{code: string, hint: string}
 */
function sms_classify_error(string $error): array
{
    $lower = strtolower($error);

    if (str_contains($lower, 'credentials are missing')) {
        return [
            'code' => 'credentials_missing',
            'hint' => 'Fill SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD in sms/.env — they are the username and password shown in the SMS Gateway app.',
        ];
    }

    if (
        str_contains($lower, 'failed to connect')
        || str_contains($lower, 'timed out')
        || str_contains($lower, 'could not resolve')
        || str_contains($lower, 'network')
    ) {
        return [
            'code' => 'gateway_unreachable',
            'hint' => 'Could not reach ' . sms_env('SMS_GATEWAY_URL', Client::DEFAULT_URL) . ' — check this machine\'s internet connection.',
        ];
    }

    if (str_contains($lower, 'unauthorized') || str_contains($lower, '401')) {
        return [
            'code' => 'gateway_rejected',
            'hint' => 'The gateway refused the login. Copy the username and password again from the SMS Gateway app — they change if the account is reset.',
        ];
    }

    return [
        'code' => 'gateway_error',
        'hint' => 'The gateway accepted the request but reported a problem. Check that the app is signed in and the phone has signal.',
    ];
}

/**
 * Send one text through the phone's gateway.
 *
 * @return array{ok: bool, id: ?string, state: ?string, error: string}
 */
function sms_send(string $number, string $message): array
{
    if ($number === '') {
        return ['ok' => false, 'id' => null, 'state' => null, 'error' => 'Missing recipient'];
    }
    if (trim($message) === '') {
        return ['ok' => false, 'id' => null, 'state' => null, 'error' => 'Missing message text'];
    }

    try {
        $client = sms_gateway_client();
        $state = $client->Send(new Message($message, [$number]));
    } catch (Throwable $error) {
        return ['ok' => false, 'id' => null, 'state' => null, 'error' => $error->getMessage()];
    }

    // The message is already queued on the phone at this point, so a failure to
    // read its state back is not a failure to send — report the id regardless.
    $currentState = null;
    try {
        $currentState = (string) $client->GetState($state->ID())->State();
    } catch (Throwable $error) {
        // Left null; the caller logs what it has.
    }

    return [
        'ok' => true,
        'id' => $state->ID(),
        'state' => $currentState,
        'error' => '',
    ];
}
