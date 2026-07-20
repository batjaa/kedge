<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\SuggestionStatus;
use App\Enums\ThreadStatus;
use App\Enums\WorkspaceRole;
use App\Models\AuditLog;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Share;
use App\Models\ShareParticipant;
use App\Models\Thread;
use App\Models\User;
use App\Models\Workspace;
use App\Services\AuditLogger;
use App\Services\Comments\CommentModerationService;
use App\Services\Comments\CommentThreadService;
use App\Services\Import\TextProjector;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class ThreadCommentTest extends TestCase
{
    use RefreshDatabase;

    public function test_author_creates_inline_and_document_threads_replies_and_lists_in_position_order(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: "Intro\n\nFirst target paragraph.\n\nSecond target paragraph.",
        );

        $inline = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Inline comment',
                'idempotency_key' => 'inline-first',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'Second target', '2'),
            ]);

        $inline->assertCreated()
            ->assertJsonPath('type', 'inline')
            ->assertJsonPath('anchor.exact', 'Second target')
            ->assertJsonPath('first_comment.body_md', 'Inline comment');

        $documentLevel = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Whole document comment',
                'idempotency_key' => 'document-first',
            ]);

        $documentLevel->assertCreated()
            ->assertJsonPath('type', 'document')
            ->assertJsonPath('anchor', null);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$inline->json('id')}/comments", [
                'body' => 'Reply on inline thread',
                'idempotency_key' => 'reply-inline-1',
            ])
            ->assertCreated()
            ->assertJsonPath('body_md', 'Reply on inline thread');

        $list = $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads");

        $list->assertOk()
            ->assertJsonPath('data.0.type', 'document')
            ->assertJsonPath('data.0.first_comment.body_md', 'Whole document comment')
            ->assertJsonPath('data.1.type', 'inline')
            ->assertJsonPath('data.1.anchor.exact', 'Second target')
            ->assertJsonPath('data.1.comment_count', 2);

        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.created']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.created']);
        $this->assertDatabaseCount('threads', 2);
        $this->assertDatabaseCount('comments', 3);
        $this->assertDatabaseCount('anchors', 1);
    }

    public function test_inline_anchor_offsets_validate_as_utf16_code_units_after_astral_text(): void
    {
        $plainText = 'Intro 👍 target text.';
        [$author, $document] = $this->readyDocument(
            plainText: $plainText,
        );
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'target', '2');
        $this->fakeProjection(plainText: $plainText, version: '2');

        $this->assertSame(9, $anchor['start']);
        $this->assertSame(15, $anchor['end']);
        $selectedText = $this->utf16CodeUnitSlice(
            $document->currentVersion->plain_text,
            $anchor['start'],
            $anchor['end'] - $anchor['start'],
        );
        $oldCodepointSlice = mb_substr(
            $document->currentVersion->plain_text,
            $anchor['start'],
            $anchor['end'] - $anchor['start'],
            'UTF-8',
        );
        $this->assertSame('target', $selectedText);
        $this->assertNotSame('target', $oldCodepointSlice);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Emoji-safe anchor',
                'idempotency_key' => 'inline-utf16-offsets',
                'anchor' => $anchor,
            ])
            ->assertCreated()
            ->assertJsonPath('anchor.exact', 'target')
            ->assertJsonPath('anchor.start', 9)
            ->assertJsonPath('anchor.end', 15);
    }

    public function test_reviewer_can_create_inline_suggestion_and_reply_suggestion_pending(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: "Intro\n\nFirst target paragraph.\n\nSecond target paragraph.",
        );
        $reviewer = User::factory()->create(['email' => 'reviewer@example.com']);
        $reviewer->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = $this->actingAs($reviewer)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'comment_type' => 'suggestion',
                'body' => 'This reads tighter.',
                'proposed_text' => 'Second target paragraph, revised.',
                'idempotency_key' => 'inline-suggestion-first',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'Second target paragraph.', '2'),
            ]);

        $thread->assertCreated()
            ->assertJsonPath('type', 'inline')
            ->assertJsonPath('anchor.exact', 'Second target paragraph.')
            ->assertJsonPath('first_comment.type', 'suggestion')
            ->assertJsonPath('first_comment.body_md', 'This reads tighter.')
            ->assertJsonPath('first_comment.proposed_text', 'Second target paragraph, revised.')
            ->assertJsonPath('first_comment.suggestion_status', 'pending')
            ->assertJsonPath('first_comment.can_resolve_suggestion', false);

        $reply = $this->actingAs($reviewer)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'proposed_text' => 'Second target paragraph, revised again.',
                'idempotency_key' => 'inline-suggestion-reply',
            ]);

        $reply->assertCreated()
            ->assertJsonPath('type', 'suggestion')
            ->assertJsonPath('body_md', '')
            ->assertJsonPath('proposed_text', 'Second target paragraph, revised again.')
            ->assertJsonPath('suggestion_status', 'pending');

        $this->assertDatabaseHas('comments', [
            'id' => $thread->json('first_comment.id'),
            'type' => 'suggestion',
            'proposed_text' => 'Second target paragraph, revised.',
            'suggestion_status' => 'pending',
        ]);
        $this->assertDatabaseHas('comments', [
            'id' => $reply->json('id'),
            'type' => 'suggestion',
            'body_md' => '',
            'proposed_text' => 'Second target paragraph, revised again.',
            'suggestion_status' => 'pending',
        ]);
    }

    public function test_suggestion_payload_validation_and_inline_only_rule(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');

        $inlineThread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Parent',
                'idempotency_key' => 'suggestion-validation-parent',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
            ])
            ->assertCreated();

        $documentThread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Document parent',
                'idempotency_key' => 'suggestion-validation-doc-parent',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$inlineThread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'idempotency_key' => 'suggestion-missing-text',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['proposed_text']);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$inlineThread->json('id')}/comments", [
                'body' => 'Plain reply',
                'proposed_text' => 'Forbidden replacement',
                'idempotency_key' => 'comment-forbidden-proposed-text',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['proposed_text']);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'comment_type' => 'suggestion',
                'proposed_text' => 'No anchor exists.',
                'idempotency_key' => 'document-suggestion-rejected',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Suggested edits can only be posted on inline threads with an anchored selection.')
            ->assertJsonPath('errors.comment_type.0', 'Suggested edits can only be posted on inline threads with an anchored selection.');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$documentThread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'proposed_text' => 'No anchor exists.',
                'idempotency_key' => 'document-reply-suggestion-rejected',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Suggested edits can only be posted on inline threads with an anchored selection.')
            ->assertJsonPath('errors.comment_type.0', 'Suggested edits can only be posted on inline threads with an anchored selection.');
    }

    public function test_suggestions_must_change_the_anchor_text_on_create_and_reply(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'target', '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'comment_type' => 'suggestion',
                'proposed_text' => ' target ',
                'idempotency_key' => 'same-suggestion-create',
                'anchor' => $anchor,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['proposed_text'])
            ->assertJsonPath('errors.proposed_text.0', 'Suggested edits must change the selected text.');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'comment_type' => 'suggestion',
                'proposed_text' => 'replacement',
                'idempotency_key' => 'changed-suggestion-create',
                'anchor' => $anchor,
            ])
            ->assertCreated()
            ->assertJsonPath('first_comment.proposed_text', 'replacement');

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Parent',
                'idempotency_key' => 'same-suggestion-reply-parent',
                'anchor' => $anchor,
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'proposed_text' => ' target ',
                'idempotency_key' => 'same-suggestion-reply',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['proposed_text'])
            ->assertJsonPath('errors.proposed_text.0', 'Suggested edits must change the selected text.');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'proposed_text' => 'target replacement',
                'idempotency_key' => 'changed-suggestion-reply',
            ])
            ->assertCreated()
            ->assertJsonPath('proposed_text', 'target replacement');
    }

    public function test_document_author_can_accept_decline_and_reopen_suggestion_idempotently(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');
        $reviewer = User::factory()->create(['email' => 'reviewer@example.com']);
        $reviewer->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $proposedText = "Alpha target text\nwith verbatim replacement.";

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $reviewer->id,
        ]);
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'target', '2');
        $thread->anchors()->create([
            'document_version_id' => $document->currentVersion->id,
            ...$anchor,
        ]);
        $suggestion = $thread->comments()->create([
            'author_id' => $reviewer->id,
            'type' => 'suggestion',
            'body_md' => 'Please use this wording.',
            'proposed_text' => $proposedText,
            'suggestion_status' => 'pending',
        ]);
        $commentId = $suggestion->id;
        Log::spy();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$commentId}/suggestion", ['status' => 'accepted'])
            ->assertOk()
            ->assertJsonPath('suggestion_status', 'accepted')
            ->assertJsonPath('proposed_text', $proposedText)
            ->assertJsonPath('can_resolve_suggestion', true);

        $acceptedAuditCount = DB::table('audit_logs')->where('action', 'suggestion.accepted')->count();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$commentId}/suggestion", ['status' => 'accepted'])
            ->assertOk()
            ->assertJsonPath('suggestion_status', 'accepted');

        $this->assertSame(
            $acceptedAuditCount,
            DB::table('audit_logs')->where('action', 'suggestion.accepted')->count(),
        );

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$commentId}/suggestion", ['status' => 'declined'])
            ->assertOk()
            ->assertJsonPath('suggestion_status', 'declined');

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$commentId}/suggestion", ['status' => 'pending'])
            ->assertOk()
            ->assertJsonPath('suggestion_status', 'pending');

        $this->assertDatabaseHas('comments', [
            'id' => $commentId,
            'type' => 'suggestion',
            'proposed_text' => $proposedText,
            'suggestion_status' => 'pending',
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'suggestion.accepted', 'subject_id' => $commentId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'suggestion.declined', 'subject_id' => $commentId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'suggestion.reopened', 'subject_id' => $commentId]);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'suggestion.accepted'
            && $context['comment_id'] === $commentId
            && $context['user_id'] === $author->id);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'suggestion.declined'
            && $context['comment_id'] === $commentId
            && $context['user_id'] === $author->id);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'suggestion.reopened'
            && $context['comment_id'] === $commentId
            && $context['user_id'] === $author->id);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk()
            ->assertJsonPath('data.0.first_comment.proposed_text', $proposedText)
            ->assertJsonPath('data.0.first_comment.can_resolve_suggestion', true);
    }

    public function test_non_authors_cannot_transition_suggestion_status(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');
        $threadCreator = User::factory()->create(['email' => 'creator@example.com']);
        $suggestionAuthor = User::factory()->create(['email' => 'suggestion-author@example.com']);
        $randomMember = User::factory()->create(['email' => 'random@example.com']);

        foreach ([$threadCreator, $suggestionAuthor, $randomMember] as $user) {
            $user->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        }

        $thread = $this->actingAs($threadCreator)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Parent',
                'idempotency_key' => 'suggestion-auth-parent',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
            ])
            ->assertCreated();

        $suggestion = $this->actingAs($suggestionAuthor)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'comment_type' => 'suggestion',
                'proposed_text' => 'replacement',
                'idempotency_key' => 'suggestion-auth-reply',
            ])
            ->assertCreated();

        foreach ([$suggestionAuthor, $threadCreator, $randomMember] as $user) {
            $this->actingAs($user)->fromWebApp()
                ->patchJson("/api/v1/comments/{$suggestion->json('id')}/suggestion", ['status' => 'accepted'])
                ->assertForbidden();
        }

        $this->assertDatabaseHas('comments', [
            'id' => $suggestion->json('id'),
            'suggestion_status' => 'pending',
        ]);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'suggestion.accepted']);
        $this->assertSame($author->id, $document->created_by);
    }

    public function test_concurrent_suggestion_flips_preserve_history_and_last_author_action_wins(): void
    {
        [$author, $document] = $this->readyDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $suggestion = $thread->comments()->create([
            'author_id' => $author->id,
            'type' => 'suggestion',
            'body_md' => '',
            'proposed_text' => 'replacement',
            'suggestion_status' => 'pending',
        ]);

        $acceptSnapshot = Comment::query()->findOrFail($suggestion->id);
        $declineSnapshot = Comment::query()->findOrFail($suggestion->id);
        $service = app(CommentModerationService::class);

        // True concurrent flips are serialized by lockForUpdate; this stale-model
        // sequence verifies the audit reads the committed prior status.
        $service->updateSuggestionStatus($acceptSnapshot, $author, SuggestionStatus::Accepted, null);
        $service->updateSuggestionStatus($declineSnapshot, $author, SuggestionStatus::Declined, null);

        $this->assertDatabaseHas('comments', [
            'id' => $suggestion->id,
            'suggestion_status' => 'declined',
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'suggestion.accepted', 'subject_id' => $suggestion->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'suggestion.declined', 'subject_id' => $suggestion->id]);

        $declineMeta = AuditLog::query()
            ->where('action', 'suggestion.declined')
            ->where('subject_id', $suggestion->id)
            ->firstOrFail()
            ->meta;
        $this->assertSame('accepted', $declineMeta['previous_status'] ?? null);
        $this->assertSame('declined', $declineMeta['status'] ?? null);
    }

    public function test_divergent_inline_anchor_fails_after_reprojection_with_reselect_code(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: 'Alpha target text',
            projectionVersion: '1',
        );
        $this->fakeProjection('Alpha fresh text', '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Broken anchor',
                'idempotency_key' => 'broken-anchor',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '1'),
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'anchor_document_changed');

        $this->assertDatabaseCount('threads', 0);
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/projection'));
    }

    public function test_truly_stale_projection_self_heals_and_stamps_the_refreshed_version(): void
    {
        [$author, $document] = $this->readyDocument(
            content: '# Doc',
            plainText: 'Alpha target text',
            projectionVersion: '1',
        );
        $this->fakeProjection('Alpha target text', '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Stale anchor',
                'idempotency_key' => 'stale-anchor',
                'anchor' => $this->anchorFor('Alpha target text', 'target', '1'),
            ])
            ->assertCreated()
            ->assertJsonPath('anchor.exact', 'target')
            ->assertJsonPath('anchor.projection_version', '2');

        $document->currentVersion->refresh();
        $this->assertSame('Alpha target text', $document->currentVersion->plain_text);
        $this->assertSame('2', $document->currentVersion->projection_version);
        $this->assertDatabaseHas('anchors', ['exact' => 'target', 'projection_version' => '2']);
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/projection'));
    }

    public function test_orphaned_thread_rejects_non_matching_reattach_anchor(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text. Replacement text.');
        $thread = $this->orphanedThread($document, $author, 'target text');
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'Replacement text', '2');
        $anchor['exact'] = 'Missing text';
        $this->fakeProjection($document->currentVersion->plain_text, '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->id}/reanchor", ['anchor' => $anchor])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'anchor_document_changed');

        $this->assertDatabaseCount('anchors', 1);
    }

    public function test_orphaned_thread_reattach_creates_current_anchored_row_and_leaves_tray(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text. Replacement text.');
        $thread = $this->orphanedThread($document, $author, 'target text');
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'Replacement text', '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->id}/reanchor", ['anchor' => $anchor])
            ->assertOk()
            ->assertJsonPath('anchor.state', 'anchored')
            ->assertJsonPath('anchor.exact', 'Replacement text');

        $this->assertDatabaseCount('anchors', 2);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $thread->id,
            'document_version_id' => $document->currentVersion->id,
            'exact' => 'Replacement text',
            'state' => AnchorState::Anchored->value,
        ]);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.anchor.state', 'anchored')
            ->assertJsonPath('data.0.anchor.exact', 'Replacement text');
    }

    public function test_non_member_cannot_reattach_thread_by_id(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text. Replacement text.');
        $thread = $this->orphanedThread($document, $author, 'target text');
        $intruder = $this->registerUser('intruder@example.com');
        $anchor = $this->anchorFor($document->currentVersion->plain_text, 'Replacement text', '2');

        $this->actingAs($intruder)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->id}/reanchor", ['anchor' => $anchor])
            ->assertForbidden();

        $this->assertDatabaseCount('anchors', 1);
    }

    public function test_same_thread_idempotency_key_on_different_documents_creates_distinct_comments(): void
    {
        [$author, $documentA] = $this->readyDocument();
        [, $documentB] = $this->readyDocument(
            content: "# Other\n\nBeta target text",
            plainText: 'Beta target text',
            author: $author,
        );

        $first = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$documentA->id}/threads", [
                'type' => 'document',
                'body' => 'Doc A',
                'idempotency_key' => 'same-document-key',
            ])
            ->assertCreated();

        $second = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$documentB->id}/threads", [
                'type' => 'document',
                'body' => 'Doc B',
                'idempotency_key' => 'same-document-key',
            ])
            ->assertCreated();

        $this->assertNotSame($first->json('id'), $second->json('id'));
        $this->assertDatabaseCount('threads', 2);
        $this->assertDatabaseCount('comments', 2);
    }

    public function test_same_reply_idempotency_key_on_different_threads_creates_distinct_replies(): void
    {
        [$author, $document] = $this->readyDocument();

        $threadA = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent A',
                'idempotency_key' => 'parent-a',
            ])
            ->assertCreated();

        $threadB = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent B',
                'idempotency_key' => 'parent-b',
            ])
            ->assertCreated();

        $replyA = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$threadA->json('id')}/comments", [
                'body' => 'Reply A',
                'idempotency_key' => 'same-reply-key',
            ])
            ->assertCreated();

        $replyB = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$threadB->json('id')}/comments", [
                'body' => 'Reply B',
                'idempotency_key' => 'same-reply-key',
            ])
            ->assertCreated();

        $this->assertNotSame($replyA->json('id'), $replyB->json('id'));
        $this->assertDatabaseCount('comments', 4);
    }

    public function test_duplicate_thread_create_that_races_the_unique_constraint_returns_the_original(): void
    {
        [$author, $document] = $this->readyDocument();

        $first = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Original',
                'idempotency_key' => 'race-key',
            ])
            ->assertCreated();

        $this->app->bind(CommentThreadService::class, fn ($app) => new class($app->make(AuditLogger::class), $app->make(TextProjector::class)) extends CommentThreadService
        {
            private int $lookups = 0;

            protected function idempotentComment(User $author, mixed $key, string $scope, int $scopeId): ?Comment
            {
                $this->lookups++;

                if ($this->lookups === 1) {
                    return null;
                }

                return parent::idempotentComment($author, $key, $scope, $scopeId);
            }
        });

        $retry = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Duplicate',
                'idempotency_key' => 'race-key',
            ])
            ->assertOk();

        $this->assertSame($first->json('id'), $retry->json('id'));
        $this->assertDatabaseCount('threads', 1);
        $this->assertDatabaseCount('comments', 1);
    }

    public function test_thread_rail_does_not_leak_anchor_from_a_non_current_version(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');
        $versionOne = $document->currentVersion;

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Inline on V1',
                'idempotency_key' => 'v1-inline',
                'anchor' => $this->anchorFor($versionOne->plain_text, 'target', '2'),
            ])
            ->assertCreated();

        $this->attachVersion(
            $document,
            content: "# Doc\n\nReplacement body",
            plainText: 'Replacement body',
            projectionVersion: '2',
        );

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk()
            ->assertJsonPath('data.0.anchor', null);
    }

    public function test_reply_idempotency_key_returns_the_original_comment(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
                'idempotency_key' => 'reply-parent',
            ])
            ->assertCreated();

        $first = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply once',
                'idempotency_key' => 'reply-once',
            ])
            ->assertCreated();

        $retry = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply once',
                'idempotency_key' => 'reply-once',
            ])
            ->assertOk();

        $this->assertSame($first->json('id'), $retry->json('id'));
        $this->assertDatabaseCount('comments', 2);
    }

    public function test_document_author_can_resolve_and_reopen_threads_idempotently(): void
    {
        [$author, $document] = $this->readyDocument();
        $creator = User::factory()->create(['email' => 'creator@example.com']);
        $creator->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $creator->id,
        ]);
        $thread->comments()->create([
            'author_id' => $creator->id,
            'body_md' => 'Thread opener',
        ]);

        Log::spy();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'open'])
            ->assertOk()
            ->assertJsonPath('status', 'open');

        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.resolved']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.reopened']);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'thread.resolved'
            && $context['thread_id'] === $thread->id
            && $context['user_id'] === $author->id);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'thread.reopened'
            && $context['thread_id'] === $thread->id
            && $context['user_id'] === $author->id);
    }

    public function test_thread_creator_can_resolve_and_reopen_threads(): void
    {
        [$author, $document] = $this->readyDocument();
        $creator = User::factory()->create(['email' => 'creator@example.com']);
        $creator->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $creator->id,
        ]);

        $this->actingAs($creator)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $this->actingAs($creator)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'open'])
            ->assertOk()
            ->assertJsonPath('status', 'open');

        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.resolved', 'user_id' => $creator->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.reopened', 'user_id' => $creator->id]);
        $this->assertSame($author->id, $document->created_by);
    }

    public function test_random_workspace_member_cannot_resolve_threads(): void
    {
        [$author, $document] = $this->readyDocument();
        $creator = User::factory()->create(['email' => 'creator@example.com']);
        $creator->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $randomMember = User::factory()->create(['email' => 'random@example.com']);
        $randomMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $creator->id,
        ]);

        $this->actingAs($randomMember)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertForbidden();

        $this->assertDatabaseHas('threads', ['id' => $thread->id, 'status' => 'open']);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'thread.resolved']);
        $this->assertSame($author->id, $document->created_by);
    }

    public function test_non_member_document_author_can_triage_and_moderate_comments(): void
    {
        $author = User::factory()->create(['email' => 'author@example.com']);
        $workspace = Workspace::factory()->create();
        $document = Document::factory()
            ->for($workspace)
            ->ready()
            ->create(['created_by' => $author->id]);
        $this->attachVersion($document);
        $reviewer = User::factory()->create(['email' => 'reviewer@example.com']);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $reviewer->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $reviewer->id,
            'body_md' => 'Needs moderation',
        ]);

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$comment->id}", ['body' => 'Moderated body'])
            ->assertOk()
            ->assertJsonPath('body_md', 'Moderated body');

        $this->actingAs($author)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$comment->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('comments', ['id' => $comment->id]);
    }

    public function test_non_member_thread_creator_can_triage_and_comment_author_can_manage_own_comment(): void
    {
        $documentAuthor = User::factory()->create(['email' => 'author@example.com']);
        $reviewer = User::factory()->create(['email' => 'reviewer@example.com']);
        $workspace = Workspace::factory()->create();
        $document = Document::factory()
            ->for($workspace)
            ->ready()
            ->create(['created_by' => $documentAuthor->id]);
        $this->attachVersion($document);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $reviewer->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $reviewer->id,
            'body_md' => 'Reviewer comment',
        ]);

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson("/api/v1/comments/{$comment->id}", ['body' => 'Reviewer edit'])
            ->assertOk()
            ->assertJsonPath('body_md', 'Reviewer edit');

        $this->actingAs($reviewer)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$comment->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('comments', ['id' => $comment->id]);
    }

    public function test_guest_cannot_resolve_threads(): void
    {
        [, $document] = $this->readyDocument();
        $creator = User::factory()->create(['email' => 'creator@example.com']);
        $creator->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $creator->id,
        ]);

        $this->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertUnauthorized();

        $this->assertDatabaseHas('threads', ['id' => $thread->id, 'status' => 'open']);
    }

    public function test_replying_to_resolved_thread_does_not_reopen_it(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
                'idempotency_key' => 'resolved-parent',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->json('id')}", ['status' => 'resolved'])
            ->assertOk();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply while resolved',
                'idempotency_key' => 'resolved-reply',
            ])
            ->assertCreated()
            ->assertJsonPath('body_md', 'Reply while resolved');

        $this->assertDatabaseHas('threads', ['id' => $thread->json('id'), 'status' => 'resolved']);
    }

    public function test_reply_racing_with_resolve_keeps_thread_resolved(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => 'Parent',
        ]);

        $resolveSnapshot = Thread::query()->findOrFail($thread->id);
        $replySnapshot = Thread::query()->findOrFail($thread->id);
        $service = app(CommentThreadService::class);

        $service->updateStatus($resolveSnapshot, $author, ThreadStatus::Resolved, null);
        [$reply] = $service->reply($replySnapshot, $author, [
            'body' => 'Reply from stale open snapshot',
            'idempotency_key' => 'resolve-reply-race',
        ], null);

        $this->assertSame('Reply from stale open snapshot', $reply->body_md);
        $this->assertDatabaseHas('threads', ['id' => $thread->id, 'status' => 'resolved']);
        $this->assertDatabaseHas('comments', ['thread_id' => $thread->id, 'body_md' => 'Reply from stale open snapshot']);
    }

    public function test_fork_inherits_anchor_links_threads_and_can_fork_a_deleted_reply(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Parent',
                'idempotency_key' => 'fork-parent',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
            ])
            ->assertCreated();

        $reply = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Fork me',
                'idempotency_key' => 'fork-reply',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$reply->json('id')}")
            ->assertNoContent();

        Log::spy();

        $fork = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->json('id')}/fork", ['idempotency_key' => 'fork-deleted-reply'])
            ->assertCreated()
            ->assertJsonPath('status', 'open')
            ->assertJsonPath('forked_from_comment_id', $reply->json('id'))
            ->assertJsonPath('anchor.exact', 'target')
            ->assertJsonPath('first_comment.is_deleted', true)
            ->assertJsonPath('first_comment.body_md', null);

        $this->assertNotSame($thread->json('id'), $fork->json('id'));
        $this->assertDatabaseHas('threads', [
            'id' => $fork->json('id'),
            'forked_from_comment_id' => $reply->json('id'),
            'status' => 'open',
        ]);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $fork->json('id'),
            'document_version_id' => $document->currentVersion->id,
            'exact' => 'target',
        ]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.forked']);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'thread.forked'
            && $context['source_comment_id'] === $reply->json('id')
            && $context['thread_id'] === $fork->json('id'));

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk()
            ->assertJsonPath('data.0.forked_into_count', 1)
            ->assertJsonPath('data.0.forked_into.0.thread_id', $fork->json('id'))
            ->assertJsonPath('data.1.forked_from_comment_id', $reply->json('id'));
    }

    public function test_forking_member_reply_as_document_author_is_idempotent_on_retry(): void
    {
        [$owner, $document] = $this->readyDocument();
        $member = $this->registerUser('member@example.com');
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $thread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Parent',
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Member reply',
        ]);

        $first = $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->id}/fork", [
                'idempotency_key' => 'same-fork-key',
            ])
            ->assertCreated();

        $retry = $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->id}/fork", [
                'idempotency_key' => 'same-fork-key',
            ])
            ->assertOk();

        $this->assertSame($first->json('id'), $retry->json('id'));
        $this->assertDatabaseCount('threads', 2);
        $this->assertDatabaseHas('comments', [
            'thread_id' => $first->json('id'),
            'author_id' => $member->id,
            'idempotency_key' => 'same-fork-key',
            'idempotency_scope' => 'fork-comment',
            'idempotency_scope_id' => $reply->id,
        ]);
    }

    public function test_fork_requires_idempotency_key(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
                'idempotency_key' => 'fork-key-parent',
            ])
            ->assertCreated();

        $reply = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply',
                'idempotency_key' => 'fork-key-reply',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->json('id')}/fork")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['idempotency_key']);
    }

    public function test_fork_rejects_title_input_instead_of_dropping_it(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
                'idempotency_key' => 'fork-title-parent',
            ])
            ->assertCreated();

        $reply = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply',
                'idempotency_key' => 'fork-title-reply',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->json('id')}/fork", [
                'idempotency_key' => 'fork-title-key',
                'title' => 'Dropped title',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['title']);
    }

    public function test_forking_opening_comment_returns_comment_not_reply(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Opening comment',
                'idempotency_key' => 'fork-opening-parent',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$thread->json('first_comment.id')}/fork", [
                'idempotency_key' => 'fork-opening-key',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'comment_not_reply');
    }

    public function test_thread_rail_counts_forks_from_soft_deleted_replies_in_bulk_hydration(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
                'idempotency_key' => 'fork-count-parent',
            ])
            ->assertCreated();

        $deletedReply = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Deleted fork source',
                'idempotency_key' => 'fork-count-deleted-source',
            ])
            ->assertCreated();

        $liveReply = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Live fork source',
                'idempotency_key' => 'fork-count-live-source',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$deletedReply->json('id')}")
            ->assertNoContent();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$deletedReply->json('id')}/fork", [
                'idempotency_key' => 'fork-count-deleted-fork',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$liveReply->json('id')}/fork", [
                'idempotency_key' => 'fork-count-live-fork',
            ])
            ->assertCreated();

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk()
            ->assertJsonPath('data.0.forked_into_count', 2);
    }

    public function test_edit_own_comment_sets_edited_at(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Original reply',
        ]);

        Log::spy();

        $this->actingAs($member)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", ['body' => 'Edited reply'])
            ->assertOk()
            ->assertJsonPath('body_md', 'Edited reply')
            ->assertJsonPath('is_deleted', false)
            ->assertJsonPath('edited_at', fn ($value) => is_string($value));

        $this->assertDatabaseHas('comments', ['id' => $reply->id, 'body_md' => 'Edited reply']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.edited']);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'comment.edited'
            && $context['comment_id'] === $reply->id
            && $context['user_id'] === $member->id);
    }

    public function test_edit_with_new_out_of_audience_mention_is_rejected_without_persisting_body(): void
    {
        [, $document] = $this->readyDocument();
        $workspaceMember = User::factory()->create(['name' => 'Workspace Member', 'email' => 'workspace-member@example.com']);
        $workspaceMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $reviewer = User::factory()->create(['name' => 'Reviewer', 'email' => 'reviewer@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $reviewer);
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $reviewer->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $reviewer->id,
            'body_md' => 'Original reply',
        ]);

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", [
                'body' => "Original reply plus [@Workspace Member](mention:{$workspaceMember->id}).",
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'mention_out_of_audience');

        $this->assertDatabaseHas('comments', ['id' => $reply->id, 'body_md' => 'Original reply']);
        $this->assertDatabaseMissing('comment_mentions', [
            'comment_id' => $reply->id,
            'user_id' => $workspaceMember->id,
        ]);
    }

    public function test_edit_allows_preexisting_mention_after_target_leaves_audience(): void
    {
        [$author, $document] = $this->readyDocument();
        $reviewer = User::factory()->create(['name' => 'Mentioned Reviewer', 'email' => 'mentioned-reviewer@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $reviewer);
        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => "Original [@Mentioned Reviewer](mention:{$reviewer->id}).",
                'idempotency_key' => 'mention-before-revocation',
            ])
            ->assertCreated();
        $commentId = $thread->json('first_comment.id');

        $share->forceFill(['revoked_at' => now()])->save();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$commentId}", [
                'body' => "Edited typo [@Mentioned Reviewer](mention:{$reviewer->id}).",
            ])
            ->assertOk()
            ->assertJsonPath('body_md', "Edited typo [@Mentioned Reviewer](mention:{$reviewer->id}).")
            ->assertJsonPath('mentions.0.id', $reviewer->id)
            ->assertJsonPath('mentions.0.name', 'Mentioned Reviewer');

        $this->assertDatabaseHas('comments', [
            'id' => $commentId,
            'body_md' => "Edited typo [@Mentioned Reviewer](mention:{$reviewer->id}).",
        ]);
        $this->assertDatabaseHas('comment_mentions', [
            'comment_id' => $commentId,
            'user_id' => $reviewer->id,
        ]);
    }

    public function test_noop_edit_does_not_stamp_edited_at(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Original reply',
        ]);

        $this->actingAs($member)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", ['body' => 'Original reply'])
            ->assertOk()
            ->assertJsonPath('body_md', 'Original reply')
            ->assertJsonPath('edited_at', null);

        $reply->refresh();
        $this->assertNull($reply->edited_at);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'comment.edited']);
    }

    public function test_editing_soft_deleted_comment_returns_comment_deleted_instead_of_404(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Deleted reply',
        ]);
        $reply->delete();

        $this->actingAs($member)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", ['body' => 'Edited after delete'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'comment_deleted');
    }

    public function test_document_author_can_edit_other_comments_for_moderation(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Original reply',
        ]);

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", ['body' => 'Author edit'])
            ->assertOk()
            ->assertJsonPath('body_md', 'Author edit')
            ->assertJsonPath('edited_at', fn ($value) => is_string($value));

        $this->assertDatabaseHas('comments', ['id' => $reply->id, 'body_md' => 'Author edit']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.edited', 'user_id' => $author->id]);
    }

    public function test_other_member_cannot_edit_someone_elses_comment(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $otherMember = User::factory()->create(['email' => 'other-member@example.com']);
        $otherMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Original reply',
        ]);

        $this->actingAs($otherMember)->fromWebApp()
            ->patchJson("/api/v1/comments/{$reply->id}", ['body' => 'Other edit'])
            ->assertForbidden();

        $this->assertDatabaseHas('comments', ['id' => $reply->id, 'body_md' => 'Original reply']);
    }

    public function test_delete_own_comment_leaves_tombstone_in_thread_list(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $ownReply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Delete myself',
        ]);

        Log::spy();

        $this->actingAs($member)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$ownReply->id}")
            ->assertNoContent();

        $list = $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk();

        $this->assertTrue(collect($list->json('data.0.comments'))->contains(fn (array $comment) => $comment['id'] === $ownReply->id
            && $comment['is_deleted'] === true
            && $comment['body_md'] === null));
        $this->assertSoftDeleted('comments', ['id' => $ownReply->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.deleted']);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'comment.deleted'
            && $context['comment_id'] === $ownReply->id
            && $context['user_id'] === $member->id);
    }

    public function test_document_author_can_moderate_other_comments(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $moderatedReply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Moderate me',
        ]);

        Log::spy();

        $this->actingAs($author)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$moderatedReply->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('comments', ['id' => $moderatedReply->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.deleted', 'user_id' => $author->id]);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'comment.deleted'
            && $context['comment_id'] === $moderatedReply->id
            && $context['user_id'] === $author->id);
    }

    public function test_other_member_cannot_delete_someone_elses_comment(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $otherMember = User::factory()->create(['email' => 'other-member@example.com']);
        $otherMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $member->id,
            'body_md' => 'Not yours',
        ]);

        $this->actingAs($otherMember)->fromWebApp()
            ->deleteJson("/api/v1/comments/{$reply->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('comments', ['id' => $reply->id, 'deleted_at' => null]);
    }

    public function test_demo_document_rejects_thread_creation_until_claimed(): void
    {
        $author = $this->registerUser();
        $document = Document::factory()->demo()->ready()->create();
        $author->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $this->attachVersion($document);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'No owner yet',
                'idempotency_key' => 'demo-unclaimed',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'demo_document_unclaimed');
    }

    public function test_reviewer_mention_autocomplete_returns_same_share_participants_not_workspace_roster(): void
    {
        [$author, $document] = $this->readyDocument();
        $workspaceMember = User::factory()->create(['name' => 'Workspace Member', 'email' => 'workspace-member@example.com']);
        $workspaceMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $sameShareReviewer = User::factory()->create(['name' => 'Same Share Reviewer', 'email' => 'same-share@example.com']);
        $currentReviewer = User::factory()->create(['name' => 'Current Reviewer', 'email' => 'current-reviewer@example.com']);
        $otherShareReviewer = User::factory()->create(['name' => 'Other Share Reviewer', 'email' => 'other-share@example.com']);
        $share = Share::factory()->for($document)->create();
        $otherShare = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $currentReviewer);
        $this->verifyParticipant($share, $sameShareReviewer);
        $this->verifyParticipant($otherShare, $otherShareReviewer);

        $response = $this->actingAs($currentReviewer)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/mention-suggestions");

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');
        $this->assertFalse($names->contains($author->name));
        $this->assertTrue($names->contains('Same Share Reviewer'));
        $this->assertFalse($names->contains('Workspace Member'));
        $this->assertFalse($names->contains('Other Share Reviewer'));
    }

    public function test_reviewer_mention_autocomplete_returns_author_after_author_comments(): void
    {
        [$author, $document] = $this->readyDocument();
        $sameShareReviewer = User::factory()->create(['name' => 'Same Share Reviewer', 'email' => 'same-share@example.com']);
        $currentReviewer = User::factory()->create(['name' => 'Current Reviewer', 'email' => 'current-reviewer@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $currentReviewer);
        $this->verifyParticipant($share, $sameShareReviewer);
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => 'Author is now visible in the discussion',
        ]);

        $response = $this->actingAs($currentReviewer)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/mention-suggestions");

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');
        $this->assertTrue($names->contains($author->name));
        $this->assertTrue($names->contains('Same Share Reviewer'));
    }

    public function test_workspace_member_mention_autocomplete_returns_workspace_members_and_document_participants(): void
    {
        [$author, $document] = $this->readyDocument();
        $workspaceMember = User::factory()->create(['name' => 'Workspace Member', 'email' => 'workspace-member@example.com']);
        $workspaceMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $shareReviewer = User::factory()->create(['name' => 'Share Reviewer', 'email' => 'share-reviewer@example.com']);
        $outsider = User::factory()->create(['name' => 'Unrelated Person', 'email' => 'unrelated@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $shareReviewer);

        $response = $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/mention-suggestions");

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Workspace Member'));
        $this->assertTrue($names->contains('Share Reviewer'));
        $this->assertFalse($names->contains($outsider->name));
    }

    public function test_mention_autocomplete_searches_literal_like_wildcards(): void
    {
        [$author, $document] = $this->readyDocument();
        $percentReviewer = User::factory()->create(['name' => 'Percent % Reviewer', 'email' => 'percent-reviewer@example.com']);
        $percentReviewer->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $response = $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/mention-suggestions?q=%25");

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Percent % Reviewer'));
    }

    public function test_out_of_audience_mention_is_rejected_on_submit(): void
    {
        [, $document] = $this->readyDocument();
        $workspaceMember = User::factory()->create(['name' => 'Workspace Member', 'email' => 'workspace-member@example.com']);
        $workspaceMember->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $reviewer = User::factory()->create(['name' => 'Reviewer', 'email' => 'reviewer@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $reviewer);

        $this->actingAs($reviewer)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => "Please ask [@Workspace Member](mention:{$workspaceMember->id}).",
                'idempotency_key' => 'out-of-audience-mention',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'mention_out_of_audience');

        $this->assertDatabaseCount('threads', 0);
        $this->assertDatabaseCount('comments', 0);
        $this->assertDatabaseCount('comment_mentions', 0);
    }

    public function test_allowed_mention_persists_its_linkage(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['name' => 'Member One', 'email' => 'member-one@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => "Please ask [@Anything](mention:{$member->id}).",
                'idempotency_key' => 'mention-member-one',
            ])
            ->assertCreated()
            ->assertJsonPath('first_comment.mentions.0.id', $member->id)
            ->assertJsonPath('first_comment.mentions.0.name', 'Member One');

        $this->assertDatabaseHas('comment_mentions', [
            'comment_id' => $thread->json('first_comment.id'),
            'user_id' => $member->id,
        ]);
    }

    public function test_reaction_toggle_dedupes_and_counts_across_users(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Reactable comment',
                'idempotency_key' => 'reactable-thread',
            ])
            ->assertCreated();
        $commentId = $thread->json('first_comment.id');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$commentId}/reactions", [])
            ->assertOk()
            ->assertJsonPath('reaction_count', 1)
            ->assertJsonPath('viewer_has_reacted', true);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$commentId}/reactions", [])
            ->assertOk()
            ->assertJsonPath('reaction_count', 0)
            ->assertJsonPath('viewer_has_reacted', false);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$commentId}/reactions", [])
            ->assertOk();
        DB::table('comment_reactions')->insert([
            'comment_id' => $commentId,
            'user_id' => $member->id,
            'emoji' => "\u{1F44D}",
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertOk()
            ->assertJsonPath('data.0.first_comment.reaction_count', 2)
            ->assertJsonPath('data.0.first_comment.viewer_has_reacted', true);

        $this->assertDatabaseCount('comment_reactions', 2);
    }

    public function test_duplicate_reaction_add_converges_without_server_error(): void
    {
        [$author, $document] = $this->readyDocument();
        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Reactable comment',
                'idempotency_key' => 'duplicate-reaction-add',
            ])
            ->assertCreated();
        $commentId = $thread->json('first_comment.id');
        $seededRaceWinner = false;

        DB::listen(function ($query) use (&$seededRaceWinner, $commentId, $author): void {
            $sql = strtolower($query->sql);
            if ($seededRaceWinner || ! str_contains($sql, 'delete') || ! str_contains($sql, 'comment_reactions')) {
                return;
            }

            $seededRaceWinner = true;
            DB::table('comment_reactions')->insert([
                'comment_id' => $commentId,
                'user_id' => $author->id,
                'emoji' => "\u{1F44D}",
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/comments/{$commentId}/reactions", [])
            ->assertOk()
            ->assertJsonPath('reaction_count', 1)
            ->assertJsonPath('viewer_has_reacted', true);

        $this->assertTrue($seededRaceWinner);
        $this->assertDatabaseCount('comment_reactions', 1);
        $this->assertDatabaseHas('comment_reactions', [
            'comment_id' => $commentId,
            'user_id' => $author->id,
            'emoji' => "\u{1F44D}",
        ]);
    }

    public function test_verified_reviewer_can_react_on_their_share_document(): void
    {
        [$author, $document] = $this->readyDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => 'Reviewer can react',
        ]);
        $reviewer = $this->registerUser('reviewer@example.com');
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $reviewer);

        $this->actingAs($reviewer)->fromWebApp()
            ->postJson("/api/v1/comments/{$comment->id}/reactions", [])
            ->assertOk()
            ->assertJsonPath('reaction_count', 1)
            ->assertJsonPath('viewer_has_reacted', true);
    }

    public function test_thread_list_reaction_counts_do_not_query_per_comment(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        for ($threadNumber = 1; $threadNumber <= 6; $threadNumber++) {
            $thread = Thread::create([
                'document_id' => $document->id,
                'type' => 'document',
                'status' => 'open',
                'created_by' => $author->id,
            ]);

            for ($commentNumber = 1; $commentNumber <= 4; $commentNumber++) {
                $comment = $thread->comments()->create([
                    'author_id' => $author->id,
                    'body_md' => "Comment {$threadNumber}.{$commentNumber}",
                ]);
                DB::table('comment_reactions')->insert([
                    'comment_id' => $comment->id,
                    'user_id' => $member->id,
                    'emoji' => "\u{1F44D}",
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(6, 'data')
            ->assertJsonPath('data.0.first_comment.reaction_count', 1);

        $reactionQueries = collect($queries)
            ->filter(fn (string $sql) => str_contains($sql, 'comment_reactions'))
            ->count();

        $this->assertLessThanOrEqual(
            1,
            $reactionQueries,
            'Thread listing should hydrate reaction counts in bulk, not per comment.',
        );
    }

    public function test_thread_write_endpoint_is_rate_limited(): void
    {
        [$author, $document] = $this->readyDocument();

        for ($i = 0; $i < 30; $i++) {
            $this->actingAs($author)->fromWebApp()
                ->postJson("/api/v1/documents/{$document->id}/threads", [])
                ->assertUnprocessable();
        }

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [])
            ->assertTooManyRequests();
    }

    public function test_thread_list_is_paginated_at_the_database(): void
    {
        [$author, $document] = $this->readyDocument();

        for ($i = 1; $i <= 25; $i++) {
            $this->actingAs($author)->fromWebApp()
                ->postJson("/api/v1/documents/{$document->id}/threads", [
                    'type' => 'document',
                    'body' => "Thread {$i}",
                    'idempotency_key' => "thread-{$i}",
                ])
                ->assertCreated();
        }

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10&page=2")
            ->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.per_page', 10)
            ->assertJsonPath('meta.total', 25);
    }

    public function test_thread_list_comment_capabilities_do_not_query_membership_per_comment(): void
    {
        [$author, $document] = $this->readyDocument();
        $member = User::factory()->create(['email' => 'member@example.com']);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        for ($threadNumber = 1; $threadNumber <= 6; $threadNumber++) {
            $thread = Thread::create([
                'document_id' => $document->id,
                'type' => 'document',
                'status' => 'open',
                'created_by' => $author->id,
            ]);

            $thread->comments()->create([
                'author_id' => $author->id,
                'body_md' => "Opening {$threadNumber}",
            ]);

            for ($replyNumber = 1; $replyNumber <= 4; $replyNumber++) {
                $thread->comments()->create([
                    'author_id' => $member->id,
                    'body_md' => "Reply {$threadNumber}.{$replyNumber}",
                ]);
            }
        }

        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(6, 'data');

        $membershipQueries = collect($queries)
            ->filter(fn (string $sql) => str_contains($sql, 'workspace_members'))
            ->count();

        $this->assertLessThanOrEqual(
            1,
            $membershipQueries,
            'Thread listing should only query workspace membership for route authorization, not per comment capability.',
        );
    }

    public function test_thread_list_thread_capabilities_do_not_query_membership_per_thread(): void
    {
        [, $document] = $this->readyDocument();
        $reviewer = User::factory()->create(['email' => 'thread-owner-reviewer@example.com']);
        $share = Share::factory()->for($document)->create();
        $this->verifyParticipant($share, $reviewer);

        for ($threadNumber = 1; $threadNumber <= 6; $threadNumber++) {
            Thread::create([
                'document_id' => $document->id,
                'type' => 'document',
                'status' => 'open',
                'created_by' => $reviewer->id,
            ]);
        }

        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });

        $this->actingAs($reviewer)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(6, 'data')
            ->assertJsonPath('data.0.can_resolve', true)
            ->assertJsonPath('data.5.can_resolve', true);

        $workspaceMembershipQueries = collect($queries)
            ->filter(fn (string $sql) => str_contains($sql, 'workspace_members'))
            ->count();
        $shareParticipantQueries = collect($queries)
            ->filter(fn (string $sql) => str_contains($sql, 'share_participants'))
            ->count();

        $this->assertLessThanOrEqual(
            2,
            $workspaceMembershipQueries,
            'Thread listing should not query workspace membership once per thread capability.',
        );
        $this->assertLessThanOrEqual(
            3,
            $shareParticipantQueries,
            'Thread listing should not query share reviewer state once per thread capability.',
        );
    }

    /**
     * @return array{User, Document}
     */
    private function readyDocument(
        string $content = "# Doc\n\nAlpha target text",
        string $plainText = 'Alpha target text',
        string $projectionVersion = '2',
        ?User $author = null,
    ): array {
        $author ??= $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $author->id]);
        $this->attachVersion($document, $content, $plainText, $projectionVersion);

        return [$author, $document->refresh()];
    }

    private function attachVersion(
        Document $document,
        string $content = "# Doc\n\nAlpha target text",
        string $plainText = 'Alpha target text',
        string $projectionVersion = '2',
    ): DocumentVersion {
        $version = DocumentVersion::factory()
            ->for($document)
            ->create([
                'content_raw' => $content,
                'content_normalized' => $content,
                'content_hash' => hash('sha256', $content),
                'plain_text' => $plainText,
                'projection_version' => $projectionVersion,
            ]);

        $document->forceFill(['current_version_id' => $version->id])->save();
        $document->setRelation('currentVersion', $version);

        return $version;
    }

    private function orphanedThread(Document $document, User $author, string $exact): Thread
    {
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => 'Needs re-attach',
        ]);
        $thread->anchors()->create($this->anchorFor($document->currentVersion->plain_text, $exact, '2') + [
            'document_version_id' => $document->currentVersion->id,
            'state' => AnchorState::Orphaned,
        ]);

        return $thread;
    }

    /**
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function anchorFor(string $plainText, string $exact, string $projectionVersion): array
    {
        $codepointStart = mb_strpos($plainText, $exact, 0, 'UTF-8');
        $this->assertNotFalse($codepointStart);
        $start = $this->utf16CodeUnitLength(mb_substr($plainText, 0, $codepointStart, 'UTF-8'));
        $end = $start + $this->utf16CodeUnitLength($exact);

        return [
            'exact' => $exact,
            'prefix' => $this->utf16CodeUnitSlice($plainText, max(0, $start - 8), min(8, $start)),
            'suffix' => $this->utf16CodeUnitSlice($plainText, $end, 8),
            'start' => $start,
            'end' => $end,
            'heading_path' => ['Doc'],
            'projection_version' => $projectionVersion,
        ];
    }

    private function utf16CodeUnitLength(string $value): int
    {
        return intdiv(strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')), 2);
    }

    private function utf16CodeUnitSlice(string $value, int $start, int $length): string
    {
        $utf16 = mb_convert_encoding($value, 'UTF-16LE', 'UTF-8');
        $slice = substr($utf16, $start * 2, $length * 2);

        return mb_convert_encoding($slice, 'UTF-8', 'UTF-16LE');
    }

    private function fakeProjection(string $plainText, string $version): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => [],
            ]),
        ]);
    }

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    private function verifyParticipant(Share $share, User $user): ShareParticipant
    {
        return ShareParticipant::create([
            'share_id' => $share->id,
            'user_id' => $user->id,
            'verified_at' => now(),
        ]);
    }
}
