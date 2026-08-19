<?php

use App\Http\Controllers\Api\V1\ActivityController;
use App\Http\Controllers\Api\V1\AgentTokenController;
use App\Http\Controllers\Api\V1\AiRunController;
use App\Http\Controllers\Api\V1\AiThreadRunController;
use App\Http\Controllers\Api\V1\ApprovalController;
use App\Http\Controllers\Api\V1\ClaimDocumentController;
use App\Http\Controllers\Api\V1\CommentReactionController;
use App\Http\Controllers\Api\V1\CommentSplitController;
use App\Http\Controllers\Api\V1\ConfigController;
use App\Http\Controllers\Api\V1\DemoDocumentController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\DocumentVersionController;
use App\Http\Controllers\Api\V1\IntegrationController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\MentionSuggestionController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\ReviewerMagicLinkController;
use App\Http\Controllers\Api\V1\ShareController;
use App\Http\Controllers\Api\V1\SharedDocumentController;
use App\Http\Controllers\Api\V1\ThreadCommentController;
use App\Http\Controllers\Api\V1\ThreadController;
use App\Http\Controllers\Api\V1\TrackedRepoController;
use App\Http\Controllers\Api\V1\WorkspaceController;
use App\Http\Controllers\Api\V1\WorkspaceSummaryController;
use App\Http\Controllers\Internal\DiagramController;
use App\Http\Middleware\RejectAgentTokenAuth;
use App\Http\Middleware\RequireAgentTokenAuth;
use App\Http\Middleware\ThrottleMcpIngress;
use App\Http\Middleware\VerifyDiagramSecret;
use App\Mcp\Servers\KedgeServer;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;

/*
|--------------------------------------------------------------------------
| Internal endpoints — NOT part of the versioned /v1 public contract
|--------------------------------------------------------------------------
|
| Trusted web→api calls, guarded by a shared secret (never publicly reachable
| in the SaaS topology), the mirror of the web's /internal/projection endpoint.
| Deliberately outside /v1 so they never look like a client-facing API.
|
| Diagram render (SPEC §6.2): the web's diagram component asks the API to render
| a Kroki diagram and cache its SVG; the API returns the cached /storage URL so
| readers embed a static <img> and never contact Kroki. A bad secret 404s (the
| endpoint's existence stays hidden), so it needs no auth:sanctum.
|
*/
Route::post('/internal/diagrams', DiagramController::class)
    ->middleware(VerifyDiagramSecret::class)
    ->name('api.internal.diagrams.render');

/*
|--------------------------------------------------------------------------
| API routes — versioned under /api/v1 from day one (SPEC 4)
|--------------------------------------------------------------------------
|
| Changes are additive-only: the web app and the API deploy independently,
| so /v1 is a contract, never a moving target. Resource routes gain
| Policies as they appear (SPEC 13); /me is identity, not a resource.
|
| This is the HUMAN API. RejectAgentTokenAuth is prepended to BOTH route groups
| in bootstrap/app.php (SPEC §15, #131), so every action here — present and
| future — refuses a bearer credential before routing; only the MCP endpoint
| (#135) opts back in. The SPA cookie path is unaffected, and mint/revoke living
| on this surface is what makes "an agent can never mint a token" structural.
|
*/

Route::prefix('v1')->group(function () {
    // Public runtime capabilities the web app reads to decide what to render
    // (e.g. the GitHub sign-in button). No auth; its own generous per-IP
    // limiter so a page-load config read never eats the login budget.
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('/config', ConfigController::class)->name('api.v1.config');
    });

    // Public read-only share surface (SPEC 10.2). No auth — the token is the
    // capability. Per-IP limiter because it faces the open internet; a valid
    // token grants exactly this doc and nothing else (no session, no id path).
    Route::middleware('throttle:reviewer-magic-link')->group(function () {
        Route::post('/shared/{token}/verify-email', [ReviewerMagicLinkController::class, 'store'])
            ->name('api.v1.shared.verify-email');
    });

    Route::middleware('throttle:reviewer-verification')->group(function () {
        Route::get('/shared/{token}/verify/{magicLink}/{magicLinkToken}', [ReviewerMagicLinkController::class, 'verify'])
            ->name('api.v1.shared.verify');
        Route::post('/shared/{token}/verify/complete', [ReviewerMagicLinkController::class, 'complete'])
            ->name('api.v1.shared.verify.complete');
    });

    Route::middleware('throttle:shared-read')->group(function () {
        Route::get('/shared/{token}', [SharedDocumentController::class, 'show'])
            ->name('api.v1.shared.show');
    });

    // ---- Instant demo mode (SPEC 10.3, #25) — SaaS-only -------------------
    //
    // The PLG wedge: an anonymous stranger pastes a public URL and gets the
    // rendered doc with zero signup. Unauthenticated by design, so it is the
    // most aggressively bounded surface in the app — `demo.enabled` 404s the
    // whole thing on a self-hosted instance, and `throttle:demo` caps it hard
    // per IP (public connectors only + SSRF guarding live in the controller and
    // the shared fetcher). The claim endpoint (authenticated) lives in the
    // guarded group below, edition-gated the same way.
    Route::middleware(['demo.enabled', 'throttle:demo'])->group(function () {
        Route::post('/demo/documents', [DemoDocumentController::class, 'store'])
            ->name('api.v1.demo.documents.store');
    });

    // ---- MCP server (SPEC §15, M4 #135) -----------------------------------
    //
    // The ONE surface in the application that accepts an Agent Token. Everything
    // else — this whole file, /logout, every route a later ticket adds — refuses
    // a bearer credential via RejectAgentTokenAuth, prepended to both route
    // groups in bootstrap/app.php. Opting back out here is what makes token
    // acceptance a positive, reviewable capability of exactly one endpoint
    // instead of a default nobody remembers to revoke; the IDOR sweep asserts
    // this group is the only exemption in the app.
    //
    // The opt-out is on the GROUP so all three registered methods share it: the
    // MCP protocol expects GET and DELETE on the endpoint to answer 405 (no SSE
    // stream here), and a 401 in their place would read to a client as a
    // credential problem rather than an unsupported transport.
    //
    // RequireAgentTokenAuth is the mirror image and just as load-bearing:
    // `auth:sanctum` also accepts the first-party session cookie, so without it a
    // signed-in human's browser could drive these tools and every comment it
    // wrote would be badged as an agent. The endpoint takes agent tokens and
    // nothing else.
    //
    // `mcp.enabled` gates the surface independently of the AI flag: a keyless
    // self-host still hosts agent reviewers. It and ThrottleMcpIngress are
    // hoisted ahead of the guard in the middleware priority list
    // (AppServiceProvider), because Laravel resolves `auth:sanctum` in front of
    // anything not in that list — a switched-off surface would otherwise 401 an
    // anonymous call and 404 only a valid one, and the per-token limiter would
    // never fire for traffic that fails to authenticate at all.
    //
    // Three limits, on three different things: ThrottleMcpIngress bounds
    // unauthenticated ingress per IP, `throttle:mcp` bounds an authenticated
    // agent per token, and the writer service spends a tighter per-token budget
    // on writes — the only layer that can tell a write from a read, since one
    // POST endpoint carries both.
    Route::middleware(['mcp.enabled', ThrottleMcpIngress::class, 'auth:sanctum', RequireAgentTokenAuth::class, 'throttle:mcp'])
        ->withoutMiddleware(RejectAgentTokenAuth::class)
        ->group(function () {
            Mcp::web('/mcp', KedgeServer::class)->name('api.v1.mcp');
        });

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', MeController::class)->name('api.v1.me');

        // Workspace settings — General (SPEC §16, M3.7 decision 11A). Rename /
        // re-slug the caller's OWN personal workspace: no id in the URL
        // (integrations-style scoping), owner-only via WorkspacePolicy, slug
        // validated + globally unique with an inline 422 on a clash. A rare
        // settings mutation, so no dedicated limiter (matches projects update).
        Route::patch('/workspace', [WorkspaceController::class, 'update'])
            ->name('api.v1.workspace.update');

        // The workspace document list — the authenticated home (SPEC 11). A free
        // read like show/poll; only the write endpoints below carry the import
        // limiter.
        Route::get('/documents', [DocumentController::class, 'index'])
            ->name('api.v1.documents.index');

        // The dashboard summary — stats strip + filter-chip counts (SPEC §16,
        // M3.7). A free workspace-scoped read behind WorkspacePolicy; the strip
        // degrades to nothing if it fails, so the list is never blocked (A1).
        Route::get('/workspace/summary', WorkspaceSummaryController::class)
            ->name('api.v1.workspace.summary');

        // The dashboard's Recent activity feed (SPEC §16, M3.8 #111). A free,
        // paginated, workspace-scoped read behind WorkspacePolicy; the panel loads
        // page 1 once with no polling and degrades to nothing if it fails (A1), so
        // the dashboard is never blocked. Only allowlisted event types with a
        // user-facing sentence are ever projected (3A).
        Route::get('/workspace/activity', ActivityController::class)
            ->name('api.v1.workspace.activity');

        // Projects (SPEC §16, M3.6), all behind ProjectPolicy. List and create
        // are scoped to the caller's own workspace; update resolves a row by id.
        // No delete this milestone. Rare mutations, so no dedicated limiter.
        Route::get('/projects', [ProjectController::class, 'index'])
            ->name('api.v1.projects.index');
        Route::post('/projects', [ProjectController::class, 'store'])
            ->name('api.v1.projects.store');
        Route::patch('/projects/{project}', [ProjectController::class, 'update'])
            ->name('api.v1.projects.update');

        // Tracked repos (SPEC §16, M3.6), behind TrackedRepoPolicy. Preview lists
        // what a scan would import with no side effects; create persists + runs the
        // first scan; show is the scan poll target; scan re-triggers. List and show
        // are free reads (the panel polls show); preview/create/scan drive outbound
        // GitHub calls, so they share the import limiter. The static `preview` path
        // is registered before the dynamic `{trackedRepo}` so it is never captured
        // as an id.
        Route::get('/tracked-repos', [TrackedRepoController::class, 'index'])
            ->name('api.v1.tracked-repos.index');

        Route::post('/tracked-repos/preview', [TrackedRepoController::class, 'preview'])
            ->middleware('throttle:imports')
            ->name('api.v1.tracked-repos.preview');

        Route::post('/tracked-repos', [TrackedRepoController::class, 'store'])
            ->middleware('throttle:imports')
            ->name('api.v1.tracked-repos.store');

        Route::get('/tracked-repos/{trackedRepo}', [TrackedRepoController::class, 'show'])
            ->name('api.v1.tracked-repos.show');

        Route::post('/tracked-repos/{trackedRepo}/scan', [TrackedRepoController::class, 'scan'])
            ->middleware('throttle:imports')
            ->name('api.v1.tracked-repos.scan');

        // Un-track (7A): delete the record, leave its documents (provenance
        // nulled). A free mutation — no outbound GitHub call — so no import limiter;
        // 409 while a scan is running.
        Route::delete('/tracked-repos/{trackedRepo}', [TrackedRepoController::class, 'destroy'])
            ->name('api.v1.tracked-repos.destroy');

        // Import & render (SPEC 5.3). Reads poll freely; the write endpoints
        // (import, retry) share a per-user limiter so a runaway paste loop or a
        // retry hammer can't flood the fetch queue (SPEC 13).
        Route::get('/documents/{document}', [DocumentController::class, 'show'])
            ->name('api.v1.documents.show');
        Route::patch('/documents/{document}', [DocumentController::class, 'update'])
            ->name('api.v1.documents.update');

        Route::get('/documents/{document}/versions', [DocumentVersionController::class, 'index'])
            ->name('api.v1.documents.versions.index');
        Route::get('/documents/{document}/versions/{version}', [DocumentVersionController::class, 'show'])
            ->name('api.v1.documents.versions.show');
        Route::get('/documents/{document}/versions/{baseVersion}/diff/{targetVersion}', [DocumentVersionController::class, 'diff'])
            ->name('api.v1.documents.versions.diff');

        Route::middleware('throttle:imports')->group(function () {
            Route::post('/documents', [DocumentController::class, 'store'])
                ->name('api.v1.documents.store');
            Route::post('/documents/{document}/retry', [DocumentController::class, 'retry'])
                ->name('api.v1.documents.retry');
            Route::post('/documents/{document}/resync', [DocumentController::class, 'resync'])
                ->middleware('resync.enabled')
                ->name('api.v1.documents.resync');

            // Manual content update for a pasted/uploaded document (#113): the
            // spec-reserved manual-only versioning path (SPEC §5.1, §7). Rides the
            // same ResyncDocumentJob pipeline as re-sync but is NOT behind
            // resync.enabled — it spawns no outbound fetch and is an upload's only
            // way to version. Shares the imports limiter (a paste-shaped write).
            Route::post('/documents/{document}/content', [DocumentController::class, 'updateContent'])
                ->name('api.v1.documents.content.update');

            // Claim a demo doc into my workspace (SPEC 10.3, #25). Edition-gated
            // like the anonymous demo import: absent entirely when self-hosted.
            Route::post('/documents/{document}/claim', ClaimDocumentController::class)
                ->middleware('demo.enabled')
                ->name('api.v1.documents.claim');
        });

        // Share-link management (SPEC 10.2), all behind SharePolicy. Listing is a
        // free read; create/revoke share a per-user limiter (share writes spawn
        // no outbound fetch but are still mutations worth bounding).
        Route::get('/documents/{document}/shares', [ShareController::class, 'index'])
            ->name('api.v1.documents.shares.index');

        Route::get('/documents/{document}/threads', [ThreadController::class, 'index'])
            ->name('api.v1.documents.threads.index');

        Route::get('/documents/{document}/mention-suggestions', [MentionSuggestionController::class, 'index'])
            ->middleware('throttle:mentions')
            ->name('api.v1.documents.mention-suggestions.index');

        Route::middleware('throttle:shares')->group(function () {
            Route::post('/documents/{document}/shares', [ShareController::class, 'store'])
                ->name('api.v1.documents.shares.store');
            Route::delete('/documents/{document}/shares/{share}', [ShareController::class, 'destroy'])
                ->scopeBindings()
                ->name('api.v1.documents.shares.destroy');
        });

        Route::middleware('throttle:comments')->group(function () {
            Route::post('/documents/{document}/approvals', [ApprovalController::class, 'store'])
                ->name('api.v1.documents.approvals.store');
            Route::delete('/approvals/{approval}', [ApprovalController::class, 'destroy'])
                ->name('api.v1.approvals.destroy');
            Route::post('/documents/{document}/threads', [ThreadController::class, 'store'])
                ->name('api.v1.documents.threads.store');
            Route::patch('/threads/{thread}', [ThreadController::class, 'update'])
                ->name('api.v1.threads.update');
            Route::post('/threads/{thread}/reanchor', [ThreadController::class, 'reanchor'])
                ->name('api.v1.threads.reanchor');
            Route::post('/threads/{thread}/comments', [ThreadCommentController::class, 'store'])
                ->name('api.v1.threads.comments.store');
            Route::post('/comments/{comment}/fork', [ThreadCommentController::class, 'fork'])
                ->withTrashed()
                ->name('api.v1.comments.fork');
            Route::patch('/comments/{comment}/suggestion', [ThreadCommentController::class, 'updateSuggestion'])
                ->withTrashed()
                ->name('api.v1.comments.suggestion.update');
            Route::patch('/comments/{comment}', [ThreadCommentController::class, 'update'])
                ->withTrashed()
                ->name('api.v1.comments.update');
            Route::delete('/comments/{comment}', [ThreadCommentController::class, 'destroy'])
                ->withTrashed()
                ->name('api.v1.comments.destroy');
            Route::post('/comments/{comment}/reactions', [CommentReactionController::class, 'store'])
                ->withTrashed()
                ->name('api.v1.comments.reactions.store');
        });

        // AI runs (SPEC §14, §17, M4), all behind AiRunPolicy and the BYO-key
        // gate: with no credential configured for the SELECTED provider (#140)
        // every route here 404s, so a keyless self-host has no AI surface at all
        // rather than broken buttons.
        //
        // The generation POST carries `throttle:ai` — each request can queue a
        // model call against the workspace's key, so the limiter bounds spend as
        // well as abuse. The two reads are the poll target and the panel's
        // re-attach-on-mount, so they stay free like every other status poll.
        Route::middleware('ai.enabled')->group(function () {
            Route::post('/documents/{document}/ai/digest', [AiRunController::class, 'digest'])
                ->middleware('throttle:ai')
                ->name('api.v1.documents.ai.digest');

            Route::get('/documents/{document}/ai/digest', [AiRunController::class, 'latestDigest'])
                ->name('api.v1.documents.ai.digest.latest');

            Route::post('/documents/{document}/ai/improve-prompt', [AiRunController::class, 'improvePrompt'])
                ->middleware('throttle:ai')
                ->name('api.v1.documents.ai.improve-prompt');

            Route::get('/documents/{document}/ai/improve-prompt', [AiRunController::class, 'latestImprovePrompt'])
                ->name('api.v1.documents.ai.improve-prompt.latest');

            // The thread-panel triage pair (#133). Same ledger contract as the
            // digest, targeted at one thread: a reply draft in the author's
            // chosen stance, and a summary of a thread too long to read. The GET
            // is the summary panel's re-attach, so re-opening a thread someone
            // already summarized costs nothing.
            Route::post('/threads/{thread}/ai/reply-draft', [AiThreadRunController::class, 'replyDraft'])
                ->middleware('throttle:ai')
                ->name('api.v1.threads.ai.reply-draft');

            Route::post('/threads/{thread}/ai/summary', [AiThreadRunController::class, 'summary'])
                ->middleware('throttle:ai')
                ->name('api.v1.threads.ai.summary');

            Route::get('/threads/{thread}/ai/summary', [AiThreadRunController::class, 'latestSummary'])
                ->name('api.v1.threads.ai.summary.latest');

            // Comment splits (#134). Proposals only: approving one is an ordinary
            // POST to /comments/{comment}/fork, so no route here ever writes
            // review data from model output (hard rule 5).
            //
            // `withTrashed()` matches the fork route's binding so a deleted
            // comment reaches the controller and is refused with a reason,
            // rather than 404ing as if it had never existed.
            Route::post('/comments/{comment}/ai/split', [CommentSplitController::class, 'store'])
                ->middleware('throttle:ai')
                ->withTrashed()
                ->name('api.v1.comments.ai.split');

            Route::get('/comments/{comment}/ai/split', [CommentSplitController::class, 'show'])
                ->withTrashed()
                ->name('api.v1.comments.ai.split.latest');

            Route::get('/ai-runs/{aiRun}', [AiRunController::class, 'show'])
                ->name('api.v1.ai-runs.show');
        });

        // Agent tokens (SPEC §15, #131), all behind AgentTokenPolicy — full
        // workspace membership to mint/list/revoke, plus ownership to revoke.
        // Listing is a free read; mint and revoke share a per-user limiter
        // (credential mutations are rare and worth bounding). These live INSIDE
        // the v1 group on purpose: the group refuses token authentication, so an
        // agent can never mint or revoke a token — its own or anyone else's.
        Route::get('/agent-tokens', [AgentTokenController::class, 'index'])
            ->name('api.v1.agent-tokens.index');

        Route::middleware('throttle:agent-tokens')->group(function () {
            Route::post('/agent-tokens', [AgentTokenController::class, 'store'])
                ->name('api.v1.agent-tokens.store');
            Route::delete('/agent-tokens/{agentToken}', [AgentTokenController::class, 'destroy'])
                ->name('api.v1.agent-tokens.destroy');
        });

        // Integration credentials (SPEC §16, §13), all behind IntegrationPolicy.
        // The masked list is a free read; connect/disconnect share a per-user
        // limiter (credential mutations are rare and worth bounding). Credentials
        // are encrypted at rest and never returned — see IntegrationResource.
        Route::get('/integrations', [IntegrationController::class, 'index'])
            ->name('api.v1.integrations.index');

        Route::middleware('throttle:integrations')->group(function () {
            Route::post('/integrations', [IntegrationController::class, 'store'])
                ->name('api.v1.integrations.store');
            Route::delete('/integrations/{integration}', [IntegrationController::class, 'destroy'])
                ->name('api.v1.integrations.destroy');
        });
    });
});
