<?php

namespace App\Support;

use Illuminate\Support\Str;
use RuntimeException;

class EmailDigest
{
    public static function for(string $email): string
    {
        return hash_hmac('sha256', Str::lower(trim($email)), self::key());
    }

    private static function key(): string
    {
        $key = (string) config('app.key');

        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded !== false) {
                $key = $decoded;
            }
        }

        if ($key === '') {
            throw new RuntimeException('APP_KEY is required to digest email addresses.');
        }

        return $key;
    }
}
