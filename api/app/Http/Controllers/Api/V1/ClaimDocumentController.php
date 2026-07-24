<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AuditEvent;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\DocumentResource;
use App\Models\Document;
use App\Policies\DocumentPolicy;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Claim a demo document into the signed-in user's workspace (SPEC §10.3, #25) —
 * the "trying converts to owning" half of the PLG wedge.
 *
 * Authorization is a Policy ({@see DocumentPolicy::claim}), never an inline
 * check: only a demo doc — one still owned by the reserved system workspace — is
 * claimable, so a normal doc or an already-claimed one both 403. Claiming moves
 * the doc into the claimer's personal workspace, records them as its creator, and
 * clears the demo TTL so the prune never reaps it. It is otherwise non-destructive:
 * the version(s) and any share links ride along untouched, so the link the visitor
 * already has keeps working — now pointing at a doc they own.
 *
 * Edition-gated with the demo import endpoint (`demo.enabled`): on a self-hosted
 * instance there are no demo docs, and the route 404s.
 */
class ClaimDocumentController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * POST /api/v1/documents/{document}/claim
     */
    public function __invoke(Request $request, Document $document): JsonResponse
    {
        $this->authorize('claim', $document);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $document->forceFill([
            'workspace_id' => $workspace->id,
            'created_by' => $user->id,
            'expires_at' => null,
        ])->save();

        $this->audit->record(
            $workspace,
            $user,
            AuditEvent::DemoClaimed,
            $document,
            ['source_url' => $document->source_url],
            $request->ip(),
        );

        Log::info('demo.claimed', [
            'document_id' => $document->id,
            'workspace_id' => $workspace->id,
            'user_id' => $user->id,
        ]);

        return DocumentResource::make($document->load('currentVersion'))
            ->response()
            ->setStatusCode(200);
    }
}
