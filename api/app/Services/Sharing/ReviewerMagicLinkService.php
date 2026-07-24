<?php

namespace App\Services\Sharing;

use App\Enums\AuditEvent;
use App\Enums\ReviewerVerificationStatus;
use App\Mail\ReviewerMagicLinkMail;
use App\Models\Share;
use App\Models\ShareMagicLink;
use App\Models\ShareMagicLinkCompletion;
use App\Models\ShareParticipant;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Comments\RecordsCommentEvents;
use App\Support\EmailDigest;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Throwable;

class ReviewerMagicLinkService
{
    use RecordsCommentEvents;

    public const EXPIRES_MINUTES = 15;

    public const COMPLETION_EXPIRES_MINUTES = 5;

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly ShareLinkService $links,
    ) {}

    protected function auditLogger(): AuditLogger
    {
        return $this->audit;
    }

    public function send(Share $share, string $shareToken, string $email, ?string $ip): bool
    {
        $share->loadMissing('document.workspace', 'creator');

        $plainToken = Str::random(64);
        $expiresAt = now()->addMinutes(self::EXPIRES_MINUTES);
        $magicLink = $share->magicLinks()->create([
            'email' => $email,
            'token_hash' => ShareMagicLink::hashToken($plainToken),
            'expires_at' => $expiresAt,
        ]);

        $url = URL::temporarySignedRoute(
            'api.v1.shared.verify',
            $expiresAt,
            [
                'token' => $shareToken,
                'magicLink' => $magicLink->id,
                'magicLinkToken' => $plainToken,
            ],
        );

        try {
            Mail::to($email)->send(new ReviewerMagicLinkMail(
                magicLinkUrl: $url,
                documentTitle: $share->document->title,
                inviterName: $share->creator?->name ?? 'A Kedge reviewer',
                expiresAt: $expiresAt,
            ));
        } catch (Throwable $exception) {
            $magicLink->delete();
            $this->recordMagicLinkEvent(AuditEvent::MagicLinkSendFailed, $share, $email, $ip, $exception);

            return false;
        }

        $this->recordMagicLinkEvent(AuditEvent::MagicLinkSent, $share, $email, $ip);

        return true;
    }

    /**
     * Validate the signed GET and mint a short-lived completion token.
     *
     * @return array{status: ReviewerVerificationStatus, completion_token?: string}
     */
    public function beginCompletion(
        Request $request,
        string $shareToken,
        string $magicLinkId,
        string $plainMagicLinkToken,
    ): array {
        if (! $request->hasValidSignature()) {
            return [
                'status' => $this->signatureExpired($request)
                    ? ReviewerVerificationStatus::Expired
                    : ReviewerVerificationStatus::Invalid,
            ];
        }

        $share = $this->links->resolve($shareToken);
        if (! $share instanceof Share || ! $share->isActive()) {
            return ['status' => ReviewerVerificationStatus::Invalid];
        }

        return DB::transaction(function () use ($share, $magicLinkId, $plainMagicLinkToken): array {
            $magicLink = ShareMagicLink::query()
                ->whereKey($magicLinkId)
                ->where('share_id', $share->id)
                ->where('token_hash', ShareMagicLink::hashToken($plainMagicLinkToken))
                ->lockForUpdate()
                ->first();

            if (! $magicLink instanceof ShareMagicLink) {
                return ['status' => ReviewerVerificationStatus::Invalid];
            }

            if ($magicLink->isUsed()) {
                return ['status' => ReviewerVerificationStatus::Used];
            }

            if ($magicLink->isExpired()) {
                return ['status' => ReviewerVerificationStatus::Expired];
            }

            $completionToken = Str::random(64);
            $magicLink->completions()->create([
                'token_hash' => ShareMagicLinkCompletion::hashToken($completionToken),
                'expires_at' => now()->addMinutes(self::COMPLETION_EXPIRES_MINUTES),
            ]);

            return [
                'status' => ReviewerVerificationStatus::PendingCompletion,
                'completion_token' => $completionToken,
            ];
        });
    }

    /**
     * Consume a completion token, create the reviewer identity if allowed, and
     * mark the magic link used. The caller owns session login after a verified
     * result so the HTTP response can carry the regenerated session cookie.
     *
     * @return array{status: ReviewerVerificationStatus, user?: User, participant?: ShareParticipant, gone_reason?: string}
     */
    public function complete(string $shareToken, string $completionToken, ?string $ip): array
    {
        return DB::transaction(function () use ($shareToken, $completionToken, $ip): array {
            $share = Share::query()
                ->where('token_hash', Share::hashToken($shareToken))
                ->lockForUpdate()
                ->first();

            if (! $share instanceof Share) {
                return ['status' => ReviewerVerificationStatus::Invalid];
            }

            if (! $share->isActive()) {
                return [
                    'status' => ReviewerVerificationStatus::Invalid,
                    'gone_reason' => $share->goneReason() ?? 'unknown',
                ];
            }

            $completion = ShareMagicLinkCompletion::query()
                ->where('token_hash', ShareMagicLinkCompletion::hashToken($completionToken))
                ->lockForUpdate()
                ->first();

            if (! $completion instanceof ShareMagicLinkCompletion) {
                return ['status' => ReviewerVerificationStatus::Invalid];
            }

            $magicLink = ShareMagicLink::query()
                ->whereKey($completion->share_magic_link_id)
                ->where('share_id', $share->id)
                ->lockForUpdate()
                ->first();

            if (! $magicLink instanceof ShareMagicLink) {
                return ['status' => ReviewerVerificationStatus::Invalid];
            }

            if ($completion->isUsed() || $magicLink->isUsed()) {
                return ['status' => ReviewerVerificationStatus::Used];
            }

            if ($completion->isExpired() || $magicLink->isExpired()) {
                return ['status' => ReviewerVerificationStatus::Expired];
            }

            $completion->forceFill(['used_at' => now()])->save();

            $user = $this->resolveReviewerUser($magicLink->email);
            if (! $user instanceof User) {
                return ['status' => ReviewerVerificationStatus::AccountRequired];
            }

            $participant = $this->verifiedParticipant($share, $user);
            $magicLink->forceFill(['used_at' => now()])->save();

            $share->loadMissing('document.workspace');
            $this->recordParticipantVerified($share, $participant, $user, $ip);

            return [
                'status' => ReviewerVerificationStatus::Verified,
                'user' => $user,
                'participant' => $participant,
            ];
        });
    }

    private function resolveReviewerUser(string $email): ?User
    {
        $user = User::query()->where('email', $email)->first();

        if (! $user instanceof User) {
            try {
                $user = User::create([
                    'name' => $this->reviewerName($email),
                    'email' => $email,
                    'password' => null,
                ]);
            } catch (QueryException $exception) {
                $user = User::query()->where('email', $email)->first();
                if (! $user instanceof User) {
                    throw $exception;
                }
            }
        }

        if (! $user->isPureReviewer()) {
            return null;
        }

        if ($user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return $user->refresh();
    }

    private function verifiedParticipant(Share $share, User $user): ShareParticipant
    {
        try {
            $participant = ShareParticipant::query()->firstOrCreate(
                ['share_id' => $share->id, 'user_id' => $user->id],
                ['verified_at' => now()],
            );
        } catch (QueryException $exception) {
            $participant = ShareParticipant::query()
                ->where('share_id', $share->id)
                ->where('user_id', $user->id)
                ->first();

            if (! $participant instanceof ShareParticipant) {
                throw $exception;
            }
        }

        if ($participant->verified_at === null) {
            $participant->forceFill(['verified_at' => now()])->save();
        }

        return $participant->refresh();
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

    private function recordMagicLinkEvent(AuditEvent $event, Share $share, string $email, ?string $ip, ?Throwable $exception = null): void
    {
        $share->loadMissing('document.workspace', 'creator');

        $this->recordEvent(
            $event,
            $share->document,
            $share->creator,
            $share,
            $ip,
            array_filter([
                'share_id' => $share->id,
                'email_hash' => EmailDigest::for($email),
                'exception' => $exception instanceof Throwable ? $exception::class : null,
            ]),
            $event === AuditEvent::MagicLinkSendFailed ? 'warning' : 'info',
        );
    }

    private function recordParticipantVerified(Share $share, ShareParticipant $participant, User $user, ?string $ip): void
    {
        $this->recordEvent(
            AuditEvent::ParticipantVerified,
            $share->document,
            $user,
            $participant,
            $ip,
            ['share_id' => $share->id],
        );
    }
}
