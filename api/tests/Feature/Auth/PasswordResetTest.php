<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Notifications\ResetAccountPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_reset_email_links_to_frontend_and_token_is_single_use(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create(['email' => 'ada@example.com']);
        $remember = $user->remember_token;
        $this->postJson('/forgot-password', ['email' => 'ADA@example.com'])->assertOk();
        $token = null;
        Notification::assertSentTo($user, ResetAccountPassword::class, function ($mail) use ($user, &$token) {
            $token = $mail->token;
            $url = $mail->toMail($user)->actionUrl;
            $this->assertStringStartsWith(config('kedge.frontend_url').'/reset-password?', $url);
            $this->assertStringContainsString('email=ada%40example.com', $url);

            return true;
        });
        DB::table('sessions')->insert([
            'id' => 'previous-session', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time(),
        ]);
        $payload = ['email' => $user->email, 'token' => $token, 'password' => 'changed-password', 'password_confirmation' => 'changed-password'];
        $this->postJson('/reset-password', $payload)->assertOk();
        $this->assertTrue(Hash::check('changed-password', $user->fresh()->password));
        $this->assertNotSame($remember, $user->fresh()->remember_token);
        $this->assertDatabaseMissing('sessions', ['id' => 'previous-session']);
        $this->assertFalse($user->fresh()->hasVerifiedEmail());
        $this->postJson('/reset-password', $payload)->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/login', ['email' => $user->email, 'password' => 'password'])->assertUnprocessable();
        $this->postJson('/login', ['email' => $user->email, 'password' => 'changed-password'])->assertOk();
    }

    public function test_unknown_throttled_and_passwordless_accounts_get_same_response(): void
    {
        Notification::fake();
        $user = User::factory()->create();
        $known = $this->postJson('/forgot-password', ['email' => $user->email])->assertOk()->json();
        $this->assertSame($known, $this->postJson('/forgot-password', ['email' => $user->email])->assertOk()->json());
        $this->assertSame($known, $this->postJson('/forgot-password', ['email' => 'absent@example.com'])->assertOk()->json());
        $reviewer = User::factory()->create(['password' => null]);
        $this->assertSame($known, $this->postJson('/forgot-password', ['email' => $reviewer->email])->assertOk()->json());
        Notification::assertSentToTimes($user, ResetAccountPassword::class, 1);
        Notification::assertNotSentTo($reviewer, ResetAccountPassword::class);
        $token = Password::createToken($reviewer);
        $this->postJson('/reset-password', [
            'email' => $reviewer->email, 'token' => $token, 'password' => 'changed-password', 'password_confirmation' => 'changed-password',
        ])->assertUnprocessable();
        $this->assertNull($reviewer->fresh()->password);
    }

    public function test_invalid_expired_wrong_user_and_mismatched_passwords_are_rejected(): void
    {
        $user = User::factory()->create();
        $token = Password::createToken($user);
        $payload = ['email' => $user->email, 'token' => $token, 'password' => 'changed-password', 'password_confirmation' => 'changed-password'];
        $this->postJson('/reset-password', [...$payload, 'token' => 'invalid'])->assertUnprocessable()->assertJsonValidationErrors('token');
        $other = User::factory()->create();
        $this->postJson('/reset-password', [...$payload, 'email' => $other->email])->assertUnprocessable();
        $this->postJson('/reset-password', [...$payload, 'password_confirmation' => 'different'])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/reset-password', [...$payload, 'password' => 'short', 'password_confirmation' => 'short'])->assertUnprocessable();
        $this->travel(61)->minutes();
        $this->postJson('/reset-password', $payload)->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
    }
}
