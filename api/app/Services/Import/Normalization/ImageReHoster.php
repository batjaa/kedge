<?php

namespace App\Services\Import\Normalization;

use App\Models\Document;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\FetchException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use GuzzleHttp\Psr7\Uri;
use GuzzleHttp\Psr7\UriResolver;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Re-hosts the images an imported document references so the document no longer
 * depends on the origin's servers staying up (SPEC 5.2). Every image URL in the
 * normalized markdown is fetched through the one SSRF-guarded doorway
 * ({@see GuardedFetcher}), stored on the configured media disk, and the URL
 * rewritten to point at our copy.
 *
 * Failure never fails the import (SPEC §19 "image fetch fails → continue +
 * warning"): a blocked address, an unreachable host, a non-image response, or an
 * SVG that won't sanitize each leaves the original URL in place and appends a
 * warning. SVGs are sanitized before storage (hard rule #2).
 *
 * Only inline markdown images — `![alt](url "title")` — are handled; that is what
 * both native markdown and the HTML→markdown pass produce. `data:` URIs are left
 * untouched (already self-contained), as are URLs already on the media disk
 * (re-import idempotence).
 */
class ImageReHoster
{
    /**
     * Inline markdown image: `![alt](url "optional title")`. The URL is either a
     * `<...>`-wrapped run or a bare run of non-space, non-`)` characters; the
     * title (quoted or parenthesised) is preserved verbatim.
     */
    private const IMAGE_PATTERN = '/!\[(?<alt>[^\]]*)\]\(\s*(?<url><[^>]+>|[^\s)]+)(?<title>\s+(?:"[^"]*"|\'[^\']*\'|\([^)]*\)))?\s*\)/';

    /** content type => stored file extension. */
    private const EXTENSION_BY_MIME = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'image/avif' => 'avif',
        'image/bmp' => 'bmp',
        'image/x-icon' => 'ico',
        'image/vnd.microsoft.icon' => 'ico',
        'image/svg+xml' => 'svg',
    ];

    public function __construct(
        private readonly GuardedFetcher $fetcher,
        private readonly SvgSanitizer $svg,
    ) {}

    /**
     * Rewrite every re-hostable image in the markdown and collect warnings.
     *
     * @param  string  $baseUrl  The document's final URL, used to resolve relative image paths.
     * @return array{0: string, 1: list<ImportWarning>}
     */
    public function rehost(string $markdown, Document $document, string $baseUrl): array
    {
        $disk = $this->disk();
        $mediaBase = $this->mediaBaseUrl($disk);

        /** @var list<ImportWarning> $warnings */
        $warnings = [];

        // Cache identical source URLs within one document so a repeated image is
        // fetched and stored once.
        $rewrites = [];

        $rewritten = preg_replace_callback(
            self::IMAGE_PATTERN,
            function (array $m) use ($document, $baseUrl, $disk, $mediaBase, &$warnings, &$rewrites): string {
                $original = $m[0];
                $rawUrl = trim($m['url'], '<>');

                if (! $this->isRehostable($rawUrl, $mediaBase)) {
                    return $original;
                }

                $absolute = $this->absolutize($rawUrl, $baseUrl);
                if ($absolute === null) {
                    // Nothing to fetch (relative URL with no usable base). Leave
                    // it; the renderer will resolve or drop it. Not a warning —
                    // we never attempted a fetch.
                    return $original;
                }

                if (array_key_exists($absolute, $rewrites)) {
                    $newUrl = $rewrites[$absolute];

                    return $newUrl === null ? $original : $this->rebuild($m, $newUrl);
                }

                [$newUrl, $warning] = $this->store($absolute, $document, $disk);
                $rewrites[$absolute] = $newUrl;

                if ($warning !== null) {
                    $warnings[] = $warning;
                }

                return $newUrl === null ? $original : $this->rebuild($m, $newUrl);
            },
            $markdown,
        );

        // preg_replace_callback returns null only on PCRE failure; keep the input.
        return [$rewritten ?? $markdown, $warnings];
    }

    /**
     * Fetch, (sanitize if SVG,) and store one image.
     *
     * @return array{0: ?string, 1: ?ImportWarning} [new URL or null, warning or null]
     */
    private function store(string $url, Document $document, Filesystem $disk): array
    {
        try {
            $result = $this->fetcher->fetch($url, $this->maxImageBytes());
        } catch (BlockedUrlException) {
            return [null, ImportWarning::imageBlocked($url)];
        } catch (FetchException $e) {
            return [null, ImportWarning::imageFetchFailed($url, $e->getMessage())];
        } catch (Throwable $e) {
            return [null, ImportWarning::imageFetchFailed($url, $e->getMessage())];
        }

        if (! $result->successful()) {
            return [null, ImportWarning::imageFetchFailed($url, "HTTP {$result->status}")];
        }

        $extension = $this->extensionFor($result, $url);
        if ($extension === null) {
            return [null, ImportWarning::imageInvalid($url, 'not a recognised image type')];
        }

        $bytes = $result->body;

        if ($extension === 'svg') {
            $clean = $this->svg->sanitize($bytes);
            if ($clean === null) {
                return [null, ImportWarning::imageInvalid($url, 'SVG failed sanitization')];
            }
            $bytes = $clean;
        }

        // Content-addressed: identical bytes land on one path, so a re-import (or
        // the same image used twice) is idempotent and yields a stable doc hash.
        $path = "media/{$document->id}/".hash('sha256', $bytes).'.'.$extension;
        $disk->put($path, $bytes);

        return [$disk->url($path), null];
    }

    /**
     * Whether a URL is worth attempting: not empty, not a data: URI, and not
     * already pointing at our own media store.
     */
    private function isRehostable(string $url, ?string $mediaBase): bool
    {
        if ($url === '') {
            return false;
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if ($scheme === 'data') {
            return false;
        }

        if ($mediaBase !== null && str_starts_with($url, $mediaBase)) {
            return false;
        }

        return true;
    }

    /**
     * Resolve a possibly-relative image URL to an absolute http(s) URL, or null
     * if it cannot become one (relative with no usable base).
     */
    private function absolutize(string $url, string $baseUrl): ?string
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));

        if ($scheme === 'http' || $scheme === 'https') {
            return $url;
        }

        // Schemes other than http(s) but present (mailto:, etc.) are never images.
        if ($scheme !== '') {
            return null;
        }

        if ($baseUrl === '') {
            return null;
        }

        try {
            $resolved = (string) UriResolver::resolve(new Uri($baseUrl), new Uri($url));
        } catch (Throwable) {
            return null;
        }

        $resolvedScheme = strtolower((string) parse_url($resolved, PHP_URL_SCHEME));

        return ($resolvedScheme === 'http' || $resolvedScheme === 'https') ? $resolved : null;
    }

    /**
     * Decide the stored extension from the response content type, falling back to
     * the URL path's extension. Returns null when neither says "image".
     */
    private function extensionFor(FetchResult $result, string $url): ?string
    {
        $mime = strtolower((string) $result->contentType);
        if ($mime !== '' && isset(self::EXTENSION_BY_MIME[$mime])) {
            return self::EXTENSION_BY_MIME[$mime];
        }

        // A generic/absent content type is common; trust a known image extension
        // on the URL, but never invent one for an unknown type.
        if ($mime === '' || $mime === 'application/octet-stream' || $mime === 'binary/octet-stream') {
            $pathExt = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
            if (in_array($pathExt, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'], true)) {
                return $pathExt === 'jpeg' ? 'jpg' : $pathExt;
            }
        }

        return null;
    }

    /**
     * Reassemble the image markdown with the new URL, preserving alt and title.
     *
     * @param  array<string, string>  $m  Named capture groups from IMAGE_PATTERN.
     */
    private function rebuild(array $m, string $newUrl): string
    {
        $title = $m['title'] ?? '';

        return "![{$m['alt']}]({$newUrl}{$title})";
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('kedge.media.disk'));
    }

    /**
     * The public URL prefix of the media disk, used to skip URLs we already host.
     * Null when the disk exposes no URL (rehosting still works; we just can't
     * short-circuit already-hosted links).
     */
    private function mediaBaseUrl(Filesystem $disk): ?string
    {
        try {
            $probe = $disk->url('media/probe');
        } catch (Throwable) {
            return null;
        }

        $base = preg_replace('#media/probe$#', '', $probe);

        return $base !== null && $base !== '' ? $base : null;
    }

    private function maxImageBytes(): int
    {
        return (int) config('kedge.media.max_image_bytes');
    }
}
