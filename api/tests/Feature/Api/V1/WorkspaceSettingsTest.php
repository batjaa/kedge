<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AuditEvent;
use App\Enums\WorkspaceRole;
use App\Models\AuditLog;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\WorkspacePolicy;
use App\Services\AuditLogger;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * Workspace settings — General: the audited rename (SPEC §16, M3.7 decision 11A).
 * A workspace owner renames the workspace and edits its slug; the endpoint is
 * scoped to the caller's OWN personal workspace (an id is never an access path),
 * owner-only via {@see WorkspacePolicy}, the slug validated and
 * globally unique with an inline 422 on a clash, and a real change writes a
 * `workspace.renamed` audit event whose failure never fails the rename.
 */
class WorkspaceSettingsTest extends TestCase
{
    use RefreshDatabase;

    // ---- happy path --------------------------------------------------------

    public function test_owner_renames_and_reslugs_their_workspace(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $response = $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Harbor Specs', 'slug' => 'harbor-specs']);

        $response->assertOk()
            ->assertJsonPath('id', $workspace->id)
            ->assertJsonPath('name', 'Harbor Specs')
            ->assertJsonPath('slug', 'harbor-specs');

        $this->assertDatabaseHas('workspaces', [
            'id' => $workspace->id,
            'name' => 'Harbor Specs',
            'slug' => 'harbor-specs',
        ]);
    }

    public function test_a_partial_update_touches_only_the_field_sent(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $originalSlug = $workspace->slug;

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Just The Name'])
            ->assertOk()
            ->assertJsonPath('name', 'Just The Name')
            ->assertJsonPath('slug', $originalSlug);

        $this->assertDatabaseHas('workspaces', [
            'id' => $workspace->id,
            'name' => 'Just The Name',
            'slug' => $originalSlug,
        ]);
    }

    // ---- audit write (11A) -------------------------------------------------

    public function test_a_rename_writes_a_workspace_renamed_audit_event_with_old_to_new_meta(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $originalName = $workspace->name;
        $originalSlug = $workspace->slug;

        // Registration itself writes user.registered + workspace.created; scope the
        // assertion to the rename event so those are never mistaken for it.
        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Renamed Co', 'slug' => 'renamed-co'])
            ->assertOk();

        $entry = AuditLog::query()->where('action', 'workspace.renamed')->sole();

        $this->assertSame($workspace->id, $entry->workspace_id);
        $this->assertSame($user->id, $entry->user_id);
        $this->assertSame($workspace->getMorphClass(), $entry->subject_type);
        $this->assertSame($workspace->id, (int) $entry->subject_id);

        // Old → new snapshot lives in meta, so M3.8's feed can render the diff.
        $this->assertSame($originalName, $entry->meta['from']['name']);
        $this->assertSame($originalSlug, $entry->meta['from']['slug']);
        $this->assertSame('Renamed Co', $entry->meta['to']['name']);
        $this->assertSame('renamed-co', $entry->meta['to']['slug']);
    }

    public function test_a_no_op_save_writes_no_audit_event(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // Re-submitting the current values changes nothing → no feed noise.
        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => $workspace->name, 'slug' => $workspace->slug])
            ->assertOk();

        $this->assertSame(0, AuditLog::query()->where('action', 'workspace.renamed')->count());
    }

    public function test_the_rename_stands_even_when_the_audit_write_throws(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // End-to-end: the REAL recordSafely runs, but the underlying record()
        // throws (a dead audit sink). The failure is swallowed and logged, so the
        // committed rename still 200s — the hard rule for the M3.8 feed this event
        // feeds into. Bind the partial mock after registration so registration's
        // own audit writes used the real logger.
        Log::spy();
        $logger = Mockery::mock(AuditLogger::class)->makePartial();
        $logger->shouldReceive('record')->andThrow(new RuntimeException('audit sink down'));
        $this->app->instance(AuditLogger::class, $logger);

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Still Renamed', 'slug' => 'still-renamed'])
            ->assertOk()
            ->assertJsonPath('name', 'Still Renamed');

        $this->assertDatabaseHas('workspaces', [
            'id' => $workspace->id,
            'name' => 'Still Renamed',
            'slug' => 'still-renamed',
        ]);

        // The swallowed failure was logged, not lost.
        Log::shouldHaveReceived('warning')->with('audit.write_failed', Mockery::type('array'))->once();
    }

    public function test_record_safely_swallows_a_failing_write_and_logs_it(): void
    {
        // Unit-level guard on the seam itself: recordSafely never rethrows, and a
        // failure lands in the log instead. A workspace with a null id makes the
        // AuditLog insert violate the NOT NULL workspace_id constraint.
        Log::spy();

        $result = app(AuditLogger::class)->recordSafely(
            new Workspace,
            null,
            AuditEvent::WorkspaceRenamed,
        );

        $this->assertNull($result);
        $this->assertSame(0, AuditLog::query()->count());
        Log::shouldHaveReceived('warning')->with('audit.write_failed', Mockery::type('array'))->once();
    }

    public function test_record_safely_never_throws_even_when_logging_itself_fails(): void
    {
        // The failure handler must not throw either: a dead log sink can't be
        // allowed to fail the primary action. record() throws (null-id workspace),
        // then the log write throws too — recordSafely still returns null cleanly.
        Log::shouldReceive('warning')->andThrow(new RuntimeException('log sink down'));

        $result = app(AuditLogger::class)->recordSafely(
            new Workspace,
            null,
            AuditEvent::WorkspaceRenamed,
        );

        $this->assertNull($result);
    }

    // ---- validation --------------------------------------------------------

    public function test_a_blank_name_is_rejected(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_the_name_is_capped_at_100_characters(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => str_repeat('a', 101)])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => str_repeat('a', 100)])
            ->assertOk();
    }

    public function test_a_malformed_slug_is_rejected_with_a_friendly_message(): void
    {
        $user = $this->registerUser();

        $response = $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => 'Not A Slug!']);

        $response->assertStatus(422)->assertJsonValidationErrors(['slug']);
        $this->assertSame(
            'The slug may use only lowercase letters, numbers, and single hyphens.',
            $response->json('errors.slug.0'),
        );
    }

    public function test_the_slug_is_capped_at_60_characters(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => str_repeat('a', 61)])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['slug']);
    }

    // ---- uniqueness (collision rejected inline) ----------------------------

    public function test_a_slug_taken_by_another_workspace_is_rejected_inline(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $other = $this->registerUser('other@example.com');
        $other->personalWorkspace()->update(['slug' => 'taken-slug']);

        $response = $this->actingAs($owner)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => 'taken-slug']);

        $response->assertStatus(422)->assertJsonValidationErrors(['slug']);
        $this->assertSame(
            'That slug is already taken. Choose another.',
            $response->json('errors.slug.0'),
        );

        // The clash never mutated the caller's workspace.
        $this->assertDatabaseMissing('workspaces', [
            'id' => $owner->personalWorkspace()->id,
            'slug' => 'taken-slug',
        ]);
    }

    public function test_a_no_op_slug_save_to_the_workspaces_own_slug_succeeds(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // Unique-ignoring-self: re-saving the workspace's own slug must not collide
        // with its own row.
        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => $workspace->slug])
            ->assertOk();
    }

    public function test_a_slug_lost_to_a_concurrent_claim_is_rejected_inline_not_500(): void
    {
        $user = $this->registerUser();

        // Simulate the race the DB unique index guards: a colliding workspace
        // appears AFTER validation passes but BEFORE the write, so the update hits
        // the index. The endpoint must translate that into the same inline 422, not
        // an uncaught 500. The raw insert fires no model events (no recursion); the
        // guard + slug check make the listener a no-op for every other test.
        $injected = false;
        Workspace::saving(function (Workspace $w) use (&$injected) {
            if (! $injected && $w->slug === 'race-slug') {
                $injected = true;
                DB::table('workspaces')->insert([
                    'name' => 'Racer',
                    'slug' => 'race-slug',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        });

        $this->actingAs($user)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => 'race-slug'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['slug']);
    }

    // ---- authorization -----------------------------------------------------

    public function test_authorization_precedes_validation_so_a_non_owner_cannot_probe_slugs(): void
    {
        // A taken slug submitted by a workspace-less caller returns 403, NOT the
        // 422 "already taken" — authorization runs before the uniqueness probe, so
        // 422-vs-403 can never be used to enumerate which global slugs exist.
        $owner = $this->registerUser('owner@example.com');
        $owner->personalWorkspace()->update(['slug' => 'taken-slug']);

        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['slug' => 'taken-slug'])
            ->assertForbidden();
    }

    public function test_a_workspaceless_reviewer_cannot_rename_and_gets_403_not_500(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Nope'])
            ->assertForbidden();
    }

    public function test_a_member_who_is_not_owner_cannot_rename_the_workspace(): void
    {
        // The policy is the guard even for a workspace the user belongs to: a
        // non-owner member is denied. (v1 provisions every user as owner of their
        // own workspace, so this proves the role check directly.)
        $owner = $this->registerUser('owner@example.com');
        $workspace = $owner->personalWorkspace();

        $member = User::factory()->create();
        $workspace->members()->attach($member, ['role' => WorkspaceRole::Member->value]);

        $this->assertFalse(app(WorkspacePolicy::class)->update($member, $workspace));
        $this->assertTrue(app(WorkspacePolicy::class)->update($owner, $workspace));
    }

    public function test_rename_requires_authentication(): void
    {
        $this->fromWebApp()
            ->patchJson('/api/v1/workspace', ['name' => 'Anon'])
            ->assertUnauthorized();
    }

    // ---- helpers -----------------------------------------------------------

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
