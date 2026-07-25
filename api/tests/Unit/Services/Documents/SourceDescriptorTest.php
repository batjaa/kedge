<?php

namespace Tests\Unit\Services\Documents;

use App\Enums\SourceType;
use App\Models\Document;
use App\Services\Documents\SourceDescriptor;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The provenance derivation matrix (M3.10 #117, SPEC §11) against the value
 * object itself — the ONE place a document's origin becomes chip strings. A pure
 * unit: each case is an in-memory {@see Document} (no DB), so the derivation is
 * exercised directly rather than only through the list endpoint. Covers every arm
 * the spec's Testing note enumerates, including the two that guard the hard rules:
 * an un-tracked survivor still reads `repo` (story 5), and an unparseable GitHub
 * URL degrades to the host shape rather than erroring (untrusted input, §13).
 */
final class SourceDescriptorTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $attributes
     * @param  array{kind: string, path?: string, repo?: string, host?: string}  $expected
     */
    #[DataProvider('derivationProvider')]
    public function test_it_derives_the_display_ready_descriptor(array $attributes, array $expected): void
    {
        $descriptor = SourceDescriptor::fromDocument(new Document($attributes));

        $this->assertSame($expected, $descriptor->toArray());
    }

    /**
     * @return iterable<string, array{array<string, mixed>, array{kind: string, path?: string, repo?: string, host?: string}}>
     */
    public static function derivationProvider(): iterable
    {
        yield 'tracked doc → repo path (repo id present)' => [
            [
                'source_type' => SourceType::GithubPublic,
                'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/rfcs/017-anchoring.md',
                'tracked_repo_id' => 42,
                'tracked_path' => 'docs/rfcs/017-anchoring.md',
            ],
            ['kind' => 'repo', 'path' => 'docs/rfcs/017-anchoring.md'],
        ];

        yield 'un-tracked survivor → repo path (repo id nulled, story 5)' => [
            [
                'source_type' => SourceType::GithubPublic,
                'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/adr/0001.md',
                'tracked_repo_id' => null,
                'tracked_path' => 'docs/adr/0001.md',
            ],
            ['kind' => 'repo', 'path' => 'docs/adr/0001.md'],
        ];

        yield 'standalone github_public blob → github owner/repo + path' => [
            [
                'source_type' => SourceType::GithubPublic,
                'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/spec.md',
                'tracked_path' => null,
            ],
            ['kind' => 'github', 'path' => 'docs/spec.md', 'repo' => 'kedgehq/kedge'],
        ];

        yield 'standalone github_pat blob → github owner/repo + path' => [
            [
                'source_type' => SourceType::GithubPat,
                'source_url' => 'https://github.com/acme/private/blob/main/internal/notes.md',
                'tracked_path' => null,
            ],
            ['kind' => 'github', 'path' => 'internal/notes.md', 'repo' => 'acme/private'],
        ];

        yield 'unparseable github URL (tree, not blob) → host fallback, never an error' => [
            [
                'source_type' => SourceType::GithubPublic,
                'source_url' => 'https://github.com/kedgehq/kedge/tree/main/docs',
                'tracked_path' => null,
            ],
            ['kind' => 'url', 'host' => 'github.com'],
        ];

        yield 'github source with a hostless URL → url kind with no host, still no error' => [
            [
                'source_type' => SourceType::GithubPublic,
                'source_url' => 'not-a-url-at-all',
                'tracked_path' => null,
            ],
            ['kind' => 'url'],
        ];

        yield 'raw_url → source host, no path' => [
            [
                'source_type' => SourceType::RawUrl,
                'source_url' => 'https://raw.example.test/specs/plan.md',
                'tracked_path' => null,
            ],
            ['kind' => 'url', 'host' => 'raw.example.test'],
        ];

        yield 'upload → pasted (no url, no host)' => [
            [
                'source_type' => SourceType::Upload,
                'source_url' => null,
                'tracked_path' => null,
            ],
            ['kind' => 'upload'],
        ];

        yield 'empty tracked_path is not a repo source (falls through to source_type)' => [
            [
                'source_type' => SourceType::RawUrl,
                'source_url' => 'https://raw.example.test/x.md',
                'tracked_path' => '',
            ],
            ['kind' => 'url', 'host' => 'raw.example.test'],
        ];
    }

    public function test_it_exposes_the_derived_parts_as_typed_properties(): void
    {
        $descriptor = SourceDescriptor::fromDocument(new Document([
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/spec.md',
            'tracked_path' => null,
        ]));

        $this->assertSame('github', $descriptor->kind);
        $this->assertSame('kedgehq/kedge', $descriptor->repo);
        $this->assertSame('docs/spec.md', $descriptor->path);
        $this->assertNull($descriptor->host);
    }
}
