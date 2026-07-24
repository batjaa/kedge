<?php

namespace App\Services\Documents;

use App\Enums\SourceType;
use App\Models\Document;
use App\Services\Import\GithubBlobUrl;

/**
 * The display-ready provenance descriptor shipped on a document list row
 * (M3.10, SPEC §11). The ONE place a document's origin is turned into strings
 * for the chip — the web renders it, never re-derives it, so the two can't drift
 * (same rationale as projection ownership, SPEC §5.4). Kept a pure value object
 * (no query, no relation load) so every field reads off columns the list query
 * already selects: `tracked_path`, `tracked_repo_id`, `source_type`, `source_url`.
 *
 * Never throws and never yields a null descriptor: an unparseable GitHub blob URL
 * degrades to the raw-URL host shape rather than erroring, because imported URLs
 * are untrusted input (SPEC §13, the hard rendering rule).
 */
final class SourceDescriptor
{
    /**
     * @param  'repo'|'github'|'url'|'upload'  $kind
     */
    private function __construct(
        public readonly string $kind,
        public readonly ?string $path = null,
        public readonly ?string $repo = null,
        public readonly ?string $host = null,
    ) {}

    public static function fromDocument(Document $document): self
    {
        // A repo path names the doc's origin even after its tracked repo was
        // un-tracked or deleted — `tracked_repo_id` is nulled (never cascaded),
        // but the path column survives (story 5). So the path, not the repo id,
        // is what makes a doc "repo-sourced".
        if (($document->tracked_path ?? '') !== '') {
            return new self(kind: 'repo', path: $document->tracked_path);
        }

        return match ($document->source_type) {
            SourceType::GithubPublic, SourceType::GithubPat => self::fromGithubUrl($document->source_url),
            SourceType::RawUrl => self::fromRawUrl($document->source_url),
            SourceType::Upload => new self(kind: 'upload'),
        };
    }

    /**
     * A standalone GitHub import (no `tracked_path`): `owner/repo` + the blob's
     * repo-relative path, read through the SAME parser the connectors import with
     * ({@see GithubBlobUrl}) so provenance can never disagree with the fetch. An
     * unparseable URL falls through to the host shape — never null, never a throw.
     */
    private static function fromGithubUrl(?string $url): self
    {
        $blob = $url !== null ? GithubBlobUrl::fromUrl($url) : null;

        if ($blob === null) {
            return self::fromRawUrl($url);
        }

        return new self(
            kind: 'github',
            path: $blob->path,
            repo: $blob->owner.'/'.$blob->repo,
        );
    }

    /**
     * A raw-URL import: just the source host (no path — raw URLs are long and
     * low-signal). A URL with no parseable host yields a hostless descriptor
     * rather than an error; the web simply renders no value for it.
     */
    private static function fromRawUrl(?string $url): self
    {
        $host = $url !== null ? parse_url($url, PHP_URL_HOST) : null;

        return new self(kind: 'url', host: is_string($host) && $host !== '' ? $host : null);
    }

    /**
     * The wire shape (mirrored in web/lib/document-types.ts under the accepted
     * hand-sync debt). Absent fields are dropped so `source` stays lean — `kind`
     * is always present, the rest only when they carry a value.
     *
     * @return array{kind: string, path?: string, repo?: string, host?: string}
     */
    public function toArray(): array
    {
        return array_filter([
            'kind' => $this->kind,
            'path' => $this->path,
            'repo' => $this->repo,
            'host' => $this->host,
        ], static fn (?string $value): bool => $value !== null);
    }
}
