<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\ReviewerVerificationStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\CompleteReviewerMagicLinkRequest;
use App\Http\Requests\StoreReviewerMagicLinkRequest;
use App\Http\Resources\V1\CurrentUserResource;
use App\Services\Sharing\ReviewerMagicLinkService;
use App\Services\Sharing\ShareLinkService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ReviewerMagicLinkController extends Controller
{
    private const NEUTRAL_RESPONSE = [
        'message' => 'Check your email for a link to continue reviewing.',
    ];

    public function __construct(
        private readonly ShareLinkService $links,
        private readonly ReviewerMagicLinkService $magicLinks,
    ) {}

    public function store(StoreReviewerMagicLinkRequest $request, string $token): JsonResponse
    {
        $share = $this->links->resolve($token);

        if ($share === null) {
            return $this->gone('unknown');
        }

        if (! $share->isActive()) {
            return $this->gone($share->goneReason() ?? 'unknown');
        }

        $sent = $this->magicLinks->send(
            $share,
            $token,
            $request->normalizedEmail(),
            $request->ip(),
        );

        if (! $sent) {
            return response()->json([
                'message' => "We couldn't send the verification email. Try again.",
                'code' => 'magiclink_send_failed',
            ], 503);
        }

        return response()->json(self::NEUTRAL_RESPONSE, 202);
    }

    public function verify(Request $request, string $token, string $magicLink, string $magicLinkToken): RedirectResponse
    {
        $result = $this->magicLinks->beginCompletion(
            $request,
            $token,
            $magicLink,
            $magicLinkToken,
        );

        if ($result['status'] === ReviewerVerificationStatus::PendingCompletion) {
            return redirect()->away($this->shareRedirectUrl($token, [
                'verify_complete' => $result['completion_token'],
            ]));
        }

        return redirect()->away($this->shareRedirectUrl($token, ['verify' => $result['status']->value]));
    }

    public function complete(CompleteReviewerMagicLinkRequest $request, string $token): JsonResponse
    {
        if (! $request->hasSession() || ! $this->isFirstPartyFrontendRequest($request)) {
            return response()->json([
                'status' => ReviewerVerificationStatus::Invalid->value,
                'message' => 'Verification must be completed from the Kedge web app.',
            ], 419);
        }

        $result = $this->magicLinks->complete(
            $token,
            $request->completionToken(),
            $request->ip(),
        );

        if (isset($result['gone_reason'])) {
            return $this->gone($result['gone_reason']);
        }

        if ($result['status'] === ReviewerVerificationStatus::Verified) {
            Auth::guard('web')->login($result['user'], remember: true);
            $request->session()->regenerate();

            return response()->json([
                'status' => ReviewerVerificationStatus::Verified->value,
                ...CurrentUserResource::make($result['user'])->resolve($request),
            ]);
        }

        if ($result['status'] === ReviewerVerificationStatus::AccountRequired) {
            return response()->json([
                'status' => ReviewerVerificationStatus::AccountRequired->value,
                'message' => 'This email already has a Kedge account. Sign in to review this document.',
            ], 409);
        }

        return response()->json([
            'status' => $result['status']->value,
            'message' => match ($result['status']) {
                ReviewerVerificationStatus::Expired => 'That verification link expired. Request a fresh link to continue reviewing.',
                ReviewerVerificationStatus::Used => 'That verification link was already used. Request a fresh link to continue reviewing.',
                default => 'That verification link could not be verified. Request a fresh link to continue reviewing.',
            },
        ], 422);
    }

    private function gone(string $reason): JsonResponse
    {
        return response()
            ->json(['error' => 'share_gone', 'reason' => $reason], 410)
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    /**
     * @param  array<string, string>  $query
     */
    private function shareRedirectUrl(string $token, array $query): string
    {
        return config('kedge.frontend_url')
            .'/shared/'.$token
            .'?'.http_build_query($query);
    }

    private function isFirstPartyFrontendRequest(Request $request): bool
    {
        $origin = $request->headers->get('Origin');
        $referer = $request->headers->get('Referer');
        $source = $origin ?: $referer;

        if (! is_string($source) || $source === '') {
            return false;
        }

        $host = parse_url($source, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return false;
        }

        $port = parse_url($source, PHP_URL_PORT);
        $hostWithPort = is_int($port) ? "{$host}:{$port}" : $host;
        $allowed = array_map(
            fn (string $domain): string => trim($domain),
            (array) config('sanctum.stateful', []),
        );

        $frontend = (string) config('kedge.frontend_url');
        $frontendHost = parse_url($frontend, PHP_URL_HOST);
        $frontendPort = parse_url($frontend, PHP_URL_PORT);
        if (is_string($frontendHost) && $frontendHost !== '') {
            $allowed[] = is_int($frontendPort) ? "{$frontendHost}:{$frontendPort}" : $frontendHost;
        }

        return in_array($hostWithPort, array_filter($allowed), true);
    }
}
