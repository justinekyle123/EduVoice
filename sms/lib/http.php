<?php

/**
 * Small cURL wrapper for talking to the EduVoice app.
 *
 * Kept separate from `sms.php` so the gateway client stays about the phone and
 * this stays about HTTP. Uses cURL rather than file_get_contents so a stalled
 * request can time out instead of hanging the cron run.
 */

/**
 * Perform a JSON request.
 *
 * @param  string               $method  GET | POST | …
 * @param  array<string, mixed>|null $payload Body to encode, or null for none.
 * @param  list<string>         $headers Extra headers (Authorization, …).
 * @return array{ok: bool, status: int, json: array<string, mixed>|null, body: string, error: string}
 */
function sms_http_json(
    string $method,
    string $url,
    ?array $payload = null,
    array $headers = [],
    int $timeoutSeconds = 20
): array {
    $headers[] = 'Accept: application/json';

    $handle = curl_init($url);
    if ($handle === false) {
        return sms_http_failure('Could not start the request');
    }

    if ($payload !== null) {
        $encoded = json_encode($payload);
        if ($encoded === false) {
            curl_close($handle);
            return sms_http_failure('Could not encode the request body');
        }
        $headers[] = 'Content-Type: application/json';
        curl_setopt($handle, CURLOPT_POSTFIELDS, $encoded);
    }

    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeoutSeconds,
    ]);

    $body = curl_exec($handle);
    $curlError = curl_error($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    if ($body === false) {
        return sms_http_failure($curlError !== '' ? $curlError : 'The request failed');
    }

    $decoded = json_decode($body, true);

    return [
        'ok' => $status >= 200 && $status < 300,
        'status' => $status,
        'json' => is_array($decoded) ? $decoded : null,
        'body' => (string) $body,
        'error' => $status >= 200 && $status < 300 ? '' : "HTTP {$status}",
    ];
}

/** @return array{ok: bool, status: int, json: null, body: string, error: string} */
function sms_http_failure(string $error): array
{
    return [
        'ok' => false,
        'status' => 0,
        'json' => null,
        'body' => '',
        'error' => $error,
    ];
}
