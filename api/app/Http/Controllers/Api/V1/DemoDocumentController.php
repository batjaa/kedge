<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDemoDocumentRequest;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Services\AuditLogger;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\TitleSynthesizer;
use App\Services\Sharing\ShareLinkService;
use App\Services\SystemWorkspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Instant demo mode (SPEC §10.3, #25) — the PLG wedge, SaaS-only.
 *
 * An anonymous stranger pastes a public URL and, in seconds, gets the rendered
 * doc with zero signup. It reuses the whole import pipeline (queued job →
 * normalize → project → version) but with three hard constraints that make a
 * public, unauthenticated abuse surface safe (SPEC §13):
 *
 *   1. Public connectors only — GitHub public blobs and raw URLs. No upload /
 *      paste, no PAT. A URL that only the private-source connectors would claim
 *      is rejected the same as an unsupported one.
 *   2. Every fetch flows through the one SSRF-guarded doorway (GuardedFetcher),
 *      so private-network probing is impossible and oversized bodies are capped —
 *      inherited free from the shared importer.
 *   3. The doc lands in the reserved {@see SystemWorkspace} (owned by no user,
 *      created_by null) with `expires_at = now + TTL`, and a scheduled command
 *      reaps it after 48h unless it is claimed first.
 *
 * The response hands back a freshly-minted share URL — the visitor's whole
 * capability to see the doc and return to it — rather than a parallel public
 * route. The rendered share page carries the "Claim this doc" CTA.
 *
 * The route is edition-gated (`demo.enabled` 404s it when self-hosted) and
 * aggressively per-IP rate-limited (`throttle:demo`).
 */
class DemoDocumentController extends Controller
{
    /** The connectors a demo import may use — public sources only (SPEC §10.3). */
    private const PUBLIC_CONNECTORS = [SourceType::GithubPublic, SourceType::RawUrl];

    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * POST /api/v1/demo/documents — begin an anonymous import from a public URL.
     */
    public function store(
        StoreDemoDocumentRequest $request,
        ConnectorRegistry $registry,
        TitleSynthesizer $titles,
        ShareLinkService $links,
        SystemWorkspace $system,
    ): JsonResponse {
        $url = (string) $request->validated('url');
        $connector = $registry->match($url);

        // Public connectors only. A null match (nothing claims it) and a match on
        // any non-public connector collapse to the same "not supported" answer —
        // demo mode never reaches upload/paste or a private-source connector.
        if ($connector === null || ! in_array($connector->sourceType(), self::PUBLIC_CONNECTORS, true)) {
            throw ValidationException::withMessages([
                'url' => 'Demo mode supports public GitHub file links and raw document URLs.',
            ]);
        }

        $workspace = $system->resolve();

        $document = Document::create([
            'workspace_id' => $workspace->id,
            // No creator: the importer is anonymous. created_by is nullable, so the
            // demo doc simply carries none — cleaner than fabricating a system user
            // with a fake identity that would pollute users + audit attribution.
            'created_by' => null,
            'source_type' => $connector->sourceType(),
            'source_url' => $url,
            'title' => $titles->filenameFrom($url),
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
            'expires_at' => now()->addHours((int) config('kedge.demo.ttl_hours')),
        ]);

        // The visitor's whole capability: an unguessable link to watch the import
        // land and come back to the doc. No creator — the share is anonymous too.
        $issued = $links->issue($document);

        $this->audit->record(
            $workspace,
            null,
            'demo.created',
            $document,
            ['source_type' => $document->source_type->value, 'source_url' => $url],
            $request->ip(),
        );

        Log::info('demo.created', [
            'document_id' => $document->id,
            'connector' => $document->source_type->value,
            'expires_at' => $document->expires_at?->toIso8601String(),
        ]);

        ImportDocumentJob::dispatch($document);

        return response()->json([
            'status' => $document->status->value,
            'share_url' => $issued->url,
            'expires_at' => $document->expires_at?->toIso8601String(),
        ], 202);
    }
}
