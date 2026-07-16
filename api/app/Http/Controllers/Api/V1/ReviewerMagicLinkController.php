<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreReviewerMagicLinkRequest;
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

    public function verify(Request $request, string $token, string $verification, string $verificationToken): RedirectResponse
    {
        $result = $this->magicLinks->verify(
            $request,
            $token,
            $verification,
            $verificationToken,
            $request->ip(),
        );

        if ($result['status'] === 'verified') {
            Auth::guard('web')->login($result['user']);
            $request->session()->regenerate();

            return redirect()->away($this->shareRedirectUrl($token, ['verified' => '1']));
        }

        return redirect()->away($this->shareRedirectUrl($token, ['verify' => $result['status']]));
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
}
