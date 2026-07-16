<?php

namespace App\Services\Sharing;

use App\Mail\ReviewerMagicLinkMail;
use App\Models\Share;
use App\Models\ShareMagicLink;
use App\Models\ShareParticipant;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Throwable;

class ReviewerMagicLinkService
{
    public const EXPIRES_MINUTES = 15;

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly ShareLinkService $links,
    ) {}

    public function send(Share $share, string $shareToken, string $email, ?string $ip): bool
    {
        $share->loadMissing('document.workspace');

        $plainToken = Str::random(64);
        $expiresAt = now()->addMinutes(self::EXPIRES_MINUTES);
        $verification = $share->magicLinks()->create([
            'email' => $email,
            'token_hash' => ShareMagicLink::hashToken($plainToken),
            'expires_at' => $expiresAt,
        ]);

        $url = URL::temporarySignedRoute(
            'api.v1.shared.verify',
            $expiresAt,
            [
                'token' => $shareToken,
                'verification' => $verification->id,
                'verificationToken' => $plainToken,
            ],
        );

        try {
            Mail::to($email)->send(new ReviewerMagicLinkMail(
                magicLinkUrl: $url,
                documentTitle: $share->document->title,
                expiresAt: $expiresAt,
            ));
        } catch (Throwable $exception) {
            $verification->delete();
            $this->recordMagicLinkEvent('magiclink.send_failed', $share, $email, $ip, $exception);

            return false;
        }

        $this->recordMagicLinkEvent('magiclink.sent', $share, $email, $ip);

        return true;
    }

    /**
     * @return array{status: 'verified'|'expired'|'used'|'invalid', user?: User}
     */
    public function verify(Request $request, string $shareToken, string $verificationId, string $plainToken, ?string $ip): array
    {
        $share = $this->links->resolve($shareToken);
        if (! $share instanceof Share || ! $share->isActive()) {
            return ['status' => 'invalid'];
        }

        if (! $request->hasValidSignature()) {
            return ['status' => $this->signatureExpired($request) ? 'expired' : 'invalid'];
        }

        $share->loadMissing('document.workspace');

        return DB::transaction(function () use ($share, $verificationId, $plainToken, $ip): array {
            $verification = ShareMagicLink::query()
                ->whereKey($verificationId)
                ->where('share_id', $share->id)
                ->where('token_hash', ShareMagicLink::hashToken($plainToken))
                ->lockForUpdate()
                ->first();

            if (! $verification instanceof ShareMagicLink) {
                return ['status' => 'invalid'];
            }

            if ($verification->isUsed()) {
                return ['status' => 'used'];
            }

            if ($verification->isExpired()) {
                return ['status' => 'expired'];
            }

            $user = $this->resolveReviewerUser($verification->email);
            $participant = ShareParticipant::query()->updateOrCreate(
                ['share_id' => $share->id, 'user_id' => $user->id],
                ['verified_at' => now()],
            );

            $verification->forceFill(['used_at' => now()])->save();

            $this->recordParticipantVerified($share, $participant, $user, $ip);

            return ['status' => 'verified', 'user' => $user];
        });
    }

    private function resolveReviewerUser(string $email): User
    {
        $user = User::query()->where('email', $email)->first();

        if (! $user instanceof User) {
            $user = User::create([
                'name' => $this->reviewerName($email),
                'email' => $email,
                'password' => null,
            ]);
            $user->forceFill(['email_verified_at' => now()])->save();

            return $user;
        }

        if ($user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return $user;
    }

    private function reviewerName(string $email): string
    {
        $local = Str::before($email, '@');
        $name = trim(str_replace(['.', '_', '-'], ' ', $local));

        return $name === '' ? 'Reviewer' : Str::title($name);
    }

    private function signatureExpired(Request $request): bool
    {
        $expires = $request->query('expires');

        return is_numeric($expires) && (int) $expires < now()->getTimestamp();
    }

    private function recordMagicLinkEvent(string $event, Share $share, string $email, ?string $ip, ?Throwable $exception = null): void
    {
        $context = [
            'share_id' => $share->id,
            'document_id' => $share->document_id,
            'email_hash' => hash('sha256', $email),
        ];

        if ($exception instanceof Throwable) {
            $context['exception'] = $exception::class;
        }

        $event === 'magiclink.send_failed'
            ? Log::warning($event, $context)
            : Log::info($event, $context);

        $this->audit->record(
            $share->document->workspace,
            null,
            $event,
            $share,
            array_filter([
                'email_hash' => $context['email_hash'],
                'exception' => $context['exception'] ?? null,
            ]),
            $ip,
        );
    }

    private function recordParticipantVerified(Share $share, ShareParticipant $participant, User $user, ?string $ip): void
    {
        Log::info('participant.verified', [
            'share_id' => $share->id,
            'document_id' => $share->document_id,
            'participant_id' => $participant->id,
            'user_id' => $user->id,
        ]);

        $this->audit->record(
            $share->document->workspace,
            $user,
            'participant.verified',
            $participant,
            ['share_id' => $share->id],
            $ip,
        );
    }
}
