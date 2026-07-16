<?php

namespace Tests\Feature\Api\V1;

use App\Mail\ReviewerMagicLinkMail;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Share;
use App\Models\ShareMagicLinkCompletion;
use App\Models\Thread;
use App\Models\User;
use App\Services\RegistrationService;
use App\Services\Sharing\ReviewerMagicLinkService;
use App\Support\EmailDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

class ReviewerMagicLinkTest extends TestCase
{
    use RefreshDatabase;

    public function test_magic_link_request_is_enumeration_neutral_for_known_and_unknown_email(): void
    {
        [, , , $token] = $this->sharedDocument();
        User::factory()->create(['email' => 'known@example.com']);
        Mail::fake();
        Log::spy();

        $known = $this->withServerVariables(['REMOTE_ADDR' => '10.64.0.1'])
            ->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'known@example.com']);
        $unknown = $this->withServerVariables(['REMOTE_ADDR' => '10.64.0.2'])
            ->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'unknown@example.com']);

        $known->assertStatus(202);
        $unknown->assertStatus(202);
        $this->assertSame($known->json(), $unknown->json());
        $this->assertSame($known->status(), $unknown->status());
        $this->assertDatabaseCount('share_magic_links', 2);
        $this->assertDatabaseCount('share_participants', 0);
        Mail::assertSent(ReviewerMagicLinkMail::class, 2);
        Log::shouldHaveReceived('info')
            ->twice()
            ->withArgs(fn (string $event) => $event === 'magiclink.sent');
    }

    public function test_magic_link_request_is_throttled_per_email(): void
    {
        [, , , $token] = $this->sharedDocument();
        Mail::fake();

        for ($i = 0; $i < 5; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.65.0.{$i}"])
                ->fromWebApp()
                ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'repeat@example.com'])
                ->assertStatus(202);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.65.0.99'])
            ->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'repeat@example.com'])
            ->assertStatus(429);
    }

    public function test_magic_link_request_is_throttled_per_ip(): void
    {
        [, , , $token] = $this->sharedDocument();
        Mail::fake();

        for ($i = 0; $i < 20; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '10.66.0.1'])
                ->fromWebApp()
                ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => "reviewer-{$i}@example.com"])
                ->assertStatus(202);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.66.0.1'])
            ->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'reviewer-final@example.com'])
            ->assertStatus(429);
    }

    public function test_mail_transport_failure_returns_friendly_error_and_creates_no_participant(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        Mail::shouldReceive('to')
            ->once()
            ->andThrow(new RuntimeException('smtp down'));
        Log::spy();

        $this->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'reviewer@example.com'])
            ->assertStatus(503)
            ->assertJsonPath('code', 'magiclink_send_failed');

        $this->assertDatabaseCount('share_magic_links', 0);
        $this->assertDatabaseCount('share_participants', 0);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'magiclink.send_failed',
            'subject_id' => $share->id,
        ]);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(fn (string $event) => $event === 'magiclink.send_failed');
    }

    public function test_valid_magic_link_creates_reviewer_user_participant_session_and_verified_share_payload(): void
    {
        [, $document, $share, $token] = $this->sharedDocument();

        $user = $this->verifyReviewer($share, $token, 'reviewer@example.com');

        $this->assertAuthenticatedAs($user);
        $this->assertNull($user->password);
        $this->assertNull($user->github_id);
        $this->assertFalse($user->workspaces()->exists(), 'Reviewer users are not workspace members.');
        $this->assertNotNull($user->email_verified_at);
        $this->assertDatabaseHas('share_participants', [
            'share_id' => $share->id,
            'user_id' => $user->id,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'participant.verified',
            'user_id' => $user->id,
        ]);

        $this->fromWebApp()
            ->getJson("/api/v1/shared/{$token}")
            ->assertOk()
            ->assertJsonPath('reviewer.verified', true)
            ->assertJsonPath('document_id', $document->id)
            ->assertJsonMissingPath('source_url')
            ->assertJsonPath('current_version.plain_text', $document->currentVersion->plain_text);

        $this->fromWebApp()
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('workspace', null);
    }

    public function test_verify_get_only_mints_completion_token_and_does_not_authenticate_or_consume(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $url = $this->issueMagicLink($token, 'prefetch@example.com');

        $completionToken = $this->beginCompletion($url, $token);

        $this->assertGuest();
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseMissing('share_participants', ['share_id' => $share->id]);
        $this->assertDatabaseHas('share_magic_links', [
            'share_id' => $share->id,
            'used_at' => null,
        ]);
        $this->assertDatabaseHas('share_magic_link_completions', [
            'token_hash' => ShareMagicLinkCompletion::hashToken($completionToken),
            'used_at' => null,
        ]);
    }

    public function test_completion_post_rejects_non_stateful_cross_site_requests(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $completionToken = $this->beginCompletion($this->issueMagicLink($token, 'csrf@example.com'), $token);

        $this->withHeader('Origin', 'https://evil.example')
            ->postJson("/api/v1/shared/{$token}/verify/complete", [
                'completion_token' => $completionToken,
            ])->assertStatus(419);

        $this->assertGuest();
        $this->assertDatabaseMissing('share_participants', ['share_id' => $share->id]);
    }

    public function test_magic_link_for_existing_password_account_requires_sign_in_without_logging_in(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $existing = User::factory()->create(['email' => 'credentialed@example.com']);
        $completionToken = $this->beginCompletion($this->issueMagicLink($token, 'credentialed@example.com'), $token);

        $this->completeMagicLink($token, $completionToken)
            ->assertStatus(409)
            ->assertJsonPath('status', 'account_required');

        $this->assertGuest();
        $this->assertDatabaseMissing('share_participants', [
            'share_id' => $share->id,
            'user_id' => $existing->id,
        ]);
    }

    public function test_magic_link_for_existing_workspace_member_requires_sign_in_without_logging_in(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        app(RegistrationService::class)->register(
            name: 'Workspace Member',
            email: 'member-reviewer@example.com',
            password: null,
        );
        $completionToken = $this->beginCompletion($this->issueMagicLink($token, 'member-reviewer@example.com'), $token);

        $this->completeMagicLink($token, $completionToken)
            ->assertStatus(409)
            ->assertJsonPath('status', 'account_required');

        $this->assertGuest();
        $this->assertDatabaseMissing('share_participants', ['share_id' => $share->id]);
    }

    public function test_magic_link_for_existing_github_account_requires_sign_in_without_logging_in(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $existing = User::factory()->create([
            'email' => 'github-reviewer@example.com',
            'password' => null,
            'github_id' => 'gh-123',
        ]);
        $completionToken = $this->beginCompletion($this->issueMagicLink($token, 'github-reviewer@example.com'), $token);

        $this->completeMagicLink($token, $completionToken)
            ->assertStatus(409)
            ->assertJsonPath('status', 'account_required');

        $this->assertGuest();
        $this->assertDatabaseMissing('share_participants', [
            'share_id' => $share->id,
            'user_id' => $existing->id,
        ]);
    }

    public function test_expired_reused_and_tampered_magic_links_are_rejected(): void
    {
        [, , $expiredShare, $expiredToken] = $this->sharedDocument();
        $expiredUrl = $this->issueMagicLink($expiredToken, 'expired@example.com');

        $this->travel(ReviewerMagicLinkService::EXPIRES_MINUTES + 1)->minutes();
        $this->fromWebApp()
            ->get($this->pathFromUrl($expiredUrl))
            ->assertRedirect(config('kedge.frontend_url')."/shared/{$expiredToken}?verify=expired");
        $this->travelBack();
        $this->assertDatabaseMissing('share_participants', ['share_id' => $expiredShare->id]);

        [, , $usedShare, $usedToken] = $this->sharedDocument();
        $usedUrl = $this->issueMagicLink($usedToken, 'used@example.com');
        $this->completeMagicLink($usedToken, $this->beginCompletion($usedUrl, $usedToken))
            ->assertOk()
            ->assertJsonPath('status', 'verified');
        $this->fromWebApp()
            ->get($this->pathFromUrl($usedUrl))
            ->assertRedirect(config('kedge.frontend_url')."/shared/{$usedToken}?verify=used");
        $this->assertDatabaseHas('share_participants', ['share_id' => $usedShare->id]);

        [, , $tamperedShare, $tamperedToken] = $this->sharedDocument();
        $tamperedUrl = (string) preg_replace('/signature=[^&]+/', 'signature=bad', $this->issueMagicLink($tamperedToken, 'tampered@example.com'));
        $this->fromWebApp()
            ->get($this->pathFromUrl($tamperedUrl))
            ->assertRedirect(config('kedge.frontend_url')."/shared/{$tamperedToken}?verify=invalid");
        $this->assertDatabaseMissing('share_participants', ['share_id' => $tamperedShare->id]);
    }

    public function test_verified_reviewer_can_read_comment_suggest_resolve_own_thread_and_fork_own_reply(): void
    {
        [, $document, $share, $token] = $this->sharedDocument(plainText: 'Alpha target text');
        $reviewer = $this->verifyReviewer($share, $token, 'reviewer@example.com');

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertForbidden()
            ->assertJsonMissingPath('source_url');

        $thread = $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Reviewer document comment',
                'idempotency_key' => 'reviewer-document-thread',
            ])
            ->assertCreated()
            ->assertJsonPath('first_comment.author.id', $reviewer->id)
            ->assertJsonPath('first_comment.client', 'web');

        $this->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->json('id')}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('status', 'resolved');

        $reply = $this->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Fork this reply',
                'idempotency_key' => 'reviewer-reply',
            ])
            ->assertCreated();

        $this->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->json('id')}/fork", [
                'idempotency_key' => 'reviewer-fork',
            ])
            ->assertCreated()
            ->assertJsonPath('forked_from_comment_id', $reply->json('id'));

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'comment_type' => 'suggestion',
                'proposed_text' => 'Alpha replacement text',
                'idempotency_key' => 'reviewer-suggestion',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
            ])
            ->assertCreated()
            ->assertJsonPath('first_comment.type', 'suggestion')
            ->assertJsonPath('first_comment.suggestion_status', 'pending')
            ->assertJsonPath('first_comment.can_resolve_suggestion', false);
    }

    public function test_reviewer_via_share_idor_matrix_forbids_traversal_and_author_only_actions(): void
    {
        [$owner, $document, $share, $token] = $this->sharedDocument(plainText: 'Alpha target text');
        [, $otherDocument] = $this->readyDocument(owner: $owner, plainText: 'Other target text');
        $this->verifyReviewer($share, $token, 'reviewer@example.com');

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$otherDocument->id}")
            ->assertForbidden();
        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$otherDocument->id}/threads", [
                'type' => 'document',
                'body' => 'Cross-document write',
                'idempotency_key' => 'other-doc-thread',
            ])
            ->assertForbidden();

        $suggestion = $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'comment_type' => 'suggestion',
                'proposed_text' => 'Alpha replacement text',
                'idempotency_key' => 'idor-suggestion',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
            ])
            ->assertCreated();
        $this->fromWebApp()
            ->patchJson("/api/v1/comments/{$suggestion->json('first_comment.id')}/suggestion", ['status' => 'accepted'])
            ->assertForbidden();

        $ownerThread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $ownerComment = $ownerThread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Owner comment',
        ]);
        $ownerReply = $ownerThread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Owner reply',
        ]);

        $this->fromWebApp()
            ->patchJson("/api/v1/threads/{$ownerThread->id}", ['status' => 'resolved'])
            ->assertForbidden();
        $this->fromWebApp()
            ->patchJson("/api/v1/comments/{$ownerComment->id}", ['body' => 'Moderated'])
            ->assertForbidden();
        $this->fromWebApp()
            ->deleteJson("/api/v1/comments/{$ownerComment->id}")
            ->assertForbidden();
        $this->fromWebApp()
            ->postJson("/api/v1/comments/{$ownerReply->id}/fork", ['idempotency_key' => 'fork-owner-reply'])
            ->assertForbidden();

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/shares")
            ->assertForbidden();
        $this->fromWebApp()
            ->getJson('/api/v1/integrations')
            ->assertForbidden();
        $this->fromWebApp()
            ->postJson('/api/v1/documents', ['content' => '# Not allowed'])
            ->assertForbidden();
    }

    public function test_revoked_share_between_get_and_completion_fails_without_login_or_participant(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $completionToken = $this->beginCompletion($this->issueMagicLink($token, 'late-revoke@example.com'), $token);

        $share->forceFill(['revoked_at' => now()])->save();

        $this->completeMagicLink($token, $completionToken)
            ->assertStatus(410)
            ->assertJsonPath('reason', 'revoked');

        $this->assertGuest();
        $this->assertDatabaseMissing('share_participants', ['share_id' => $share->id]);
    }

    public function test_revoked_share_cuts_off_already_verified_reviewer_access(): void
    {
        [, $document, $share, $token] = $this->sharedDocument();
        $this->verifyReviewer($share, $token, 'active-until-revoked@example.com');

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Before revoke',
                'idempotency_key' => 'before-revoke',
            ])
            ->assertCreated();

        $share->forceFill(['revoked_at' => now()])->save();

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertForbidden();
        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'After revoke',
                'idempotency_key' => 'after-revoke',
            ])
            ->assertForbidden();
    }

    public function test_multiple_valid_completions_for_same_new_email_converge_without_duplicates(): void
    {
        [, , $share, $token] = $this->sharedDocument();
        $first = $this->beginCompletion($this->issueMagicLink($token, 'race@example.com'), $token);
        $second = $this->beginCompletion($this->issueMagicLink($token, 'race@example.com'), $token);

        $this->completeMagicLink($token, $first)->assertOk();
        $this->completeMagicLink($token, $second)->assertOk();

        $user = User::query()->where('email', 'race@example.com')->sole();
        $this->assertDatabaseCount('share_participants', 1);
        $this->assertDatabaseHas('share_participants', [
            'share_id' => $share->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_magic_link_audit_uses_keyed_email_hmac_not_bare_sha256(): void
    {
        [, , , $token] = $this->sharedDocument();
        Mail::fake();

        $this->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => 'Digest@Test.Example'])
            ->assertStatus(202);

        $audit = AuditLog::query()->where('action', 'magiclink.sent')->sole();

        $this->assertSame(EmailDigest::for('digest@test.example'), $audit->meta['email_hash']);
        $this->assertNotSame(hash('sha256', 'digest@test.example'), $audit->meta['email_hash']);
    }

    public function test_verify_get_and_completion_post_are_throttled_per_ip(): void
    {
        [, , , $token] = $this->sharedDocument();
        $url = $this->issueMagicLink($token, 'throttle@example.com');

        for ($i = 0; $i < 20; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '10.67.0.1'])
                ->fromWebApp()
                ->get($this->pathFromUrl($url))
                ->assertRedirect();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.67.0.1'])
            ->fromWebApp()
            ->get($this->pathFromUrl($url))
            ->assertTooManyRequests();

        for ($i = 0; $i < 20; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '10.68.0.1'])
                ->fromWebApp()
                ->postJson("/api/v1/shared/{$token}/verify/complete", ['completion_token' => 'invalid-'.$i])
                ->assertStatus(422);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.68.0.1'])
            ->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify/complete", ['completion_token' => 'invalid-final'])
            ->assertTooManyRequests();
    }

    public function test_demo_document_rejects_threads_until_claimed_even_for_verified_reviewer(): void
    {
        [, $document, $share, $token] = $this->sharedDemoDocument();
        $this->verifyReviewer($share, $token, 'reviewer@example.com');

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Demo comment',
                'idempotency_key' => 'demo-comment',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'demo_document_unclaimed');

        $this->assertDatabaseCount('threads', 0);
    }

    public function test_comment_persistence_does_not_depend_on_mail_fanout(): void
    {
        [, $document, $share, $token] = $this->sharedDocument();
        $this->verifyReviewer($share, $token, 'reviewer@example.com');
        Mail::fake();

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Saved without notification mail.',
                'idempotency_key' => 'no-mail-fanout',
            ])
            ->assertCreated();

        $this->assertDatabaseHas('comments', ['body_md' => 'Saved without notification mail.']);
        Mail::assertNothingSent();
    }

    /**
     * @return array{User, Document, Share, string}
     */
    private function sharedDocument(string $plainText = 'Alpha target text', ?User $owner = null): array
    {
        [$owner, $document] = $this->readyDocument(owner: $owner, plainText: $plainText);
        $token = 'share'.Str::random(43);
        $share = Share::factory()->for($document)->withToken($token)->create(['created_by' => $owner->id]);

        return [$owner, $document, $share, $token];
    }

    /**
     * @return array{User|null, Document, Share, string}
     */
    private function sharedDemoDocument(): array
    {
        $document = Document::factory()
            ->demo()
            ->ready()
            ->create(['created_by' => null]);
        $document = $this->attachVersion($document, 'Alpha target text');
        $token = 'demo'.Str::random(44);
        $share = Share::factory()->for($document)->withToken($token)->create(['created_by' => null]);

        return [null, $document, $share, $token];
    }

    /**
     * @return array{User, Document}
     */
    private function readyDocument(?User $owner = null, string $plainText = 'Alpha target text'): array
    {
        $owner ??= app(RegistrationService::class)->register(
            name: 'Owner User',
            email: 'owner-'.Str::lower(Str::random(8)).'@example.com',
            password: 'correct-horse-battery',
        );

        $document = Document::factory()
            ->for($owner->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $owner->id]);

        return [$owner, $this->attachVersion($document, $plainText)];
    }

    private function attachVersion(Document $document, string $plainText): Document
    {
        $content = "# Doc\n\n{$plainText}\n";
        $version = DocumentVersion::factory()
            ->for($document)
            ->create([
                'content_raw' => $content,
                'content_normalized' => $content,
                'content_hash' => hash('sha256', $content),
                'plain_text' => $plainText,
                'projection_version' => '2',
            ]);

        $document->forceFill(['current_version_id' => $version->id])->save();

        return $document->fresh('currentVersion');
    }

    private function issueMagicLink(string $token, string $email): string
    {
        Mail::fake();

        $this->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify-email", ['email' => $email])
            ->assertStatus(202)
            ->assertExactJson(['message' => 'Check your email for a link to continue reviewing.']);

        $url = null;
        Mail::assertSent(ReviewerMagicLinkMail::class, function (ReviewerMagicLinkMail $mail) use ($email, &$url): bool {
            $url = $mail->magicLinkUrl;

            return $mail->hasTo($email);
        });

        $this->assertIsString($url);

        return $url;
    }

    private function verifyReviewer(Share $share, string $token, string $email): User
    {
        $url = $this->issueMagicLink($token, $email);
        $completionToken = $this->beginCompletion($url, $token);

        $this->completeMagicLink($token, $completionToken)
            ->assertOk()
            ->assertJsonPath('status', 'verified');

        $user = User::query()->where('email', $email)->firstOrFail();
        $this->assertDatabaseHas('share_participants', [
            'share_id' => $share->id,
            'user_id' => $user->id,
        ]);

        return $user;
    }

    private function beginCompletion(string $url, string $token): string
    {
        $response = $this->fromWebApp()
            ->get($this->pathFromUrl($url))
            ->assertRedirect();

        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith(config('kedge.frontend_url')."/shared/{$token}?verify_complete=", $location);

        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertIsString($query['verify_complete'] ?? null);

        return $query['verify_complete'];
    }

    private function completeMagicLink(string $token, string $completionToken)
    {
        return $this->fromWebApp()
            ->postJson("/api/v1/shared/{$token}/verify/complete", [
                'completion_token' => $completionToken,
            ]);
    }

    private function pathFromUrl(string $url): string
    {
        $parts = parse_url($url);
        $path = (string) ($parts['path'] ?? '/');
        $query = (string) ($parts['query'] ?? '');

        return $query === '' ? $path : "{$path}?{$query}";
    }

    /**
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function anchorFor(string $plainText, string $exact, string $projectionVersion): array
    {
        $start = mb_strpos($plainText, $exact, 0, 'UTF-8');
        $this->assertNotFalse($start, 'Test anchor text must exist in the plain text.');
        $end = $start + mb_strlen($exact, 'UTF-8');

        return [
            'exact' => $exact,
            'prefix' => '',
            'suffix' => '',
            'start' => $start,
            'end' => $end,
            'heading_path' => [],
            'projection_version' => $projectionVersion,
        ];
    }
}
