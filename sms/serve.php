<?php

/**
 * Router for PHP's built-in web server.
 *
 *   php -S 127.0.0.1:8081 -t sms sms/serve.php
 *
 * Serving the whole folder would publish `sms/.env` — the gateway username and
 * password — to anyone who asks for `/.env`, which is the one file in here that
 * must never be readable over HTTP. This router allows exactly the three entry
 * points and answers 404 for everything else, including `vendor/` and `lib/`
 * source, the APK, and the composer files.
 *
 * Returning false hands the request to the server as usual (so PHP files are
 * executed); anything else means "already handled".
 */

$allowed = ['/', '/index.php', '/function/sms.php', '/send.php'];

$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = is_string($path) && $path !== '' ? $path : '/';

if (in_array($path, $allowed, true)) {
    return false;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
echo "Not found.\n\nThis folder serves only index.php, function/sms.php and send.php.\n";
return true;
