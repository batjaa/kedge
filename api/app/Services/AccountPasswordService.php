<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class AccountPasswordService
{
    public function sendLink(string $email): void
    {
        // Reviewer-only and OAuth-only identities keep their existing login path.
        Password::sendResetLink($this->credentials(['email' => $email]));
    }

    public function reset(array $credentials): string
    {
        return Password::reset($this->credentials($credentials), function (User $user, string $password): void {
            DB::transaction(function () use ($user, $password): void {
                $user->forceFill([
                    'password' => $password,
                    'remember_token' => Str::random(60),
                ])->save();

                if (config('session.driver') === 'database') {
                    DB::connection(config('session.connection'))
                        ->table(config('session.table', 'sessions'))
                        ->where('user_id', $user->id)->delete();
                }
            });

            event(new PasswordReset($user));
        });
    }

    private function credentials(array $credentials): array
    {
        $credentials['email'] = Str::lower(trim($credentials['email']));
        $credentials[] = fn ($query) => $query->whereNotNull('password');

        return $credentials;
    }
}
