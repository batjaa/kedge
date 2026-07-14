<?php

namespace App\Services\Import\Normalization;

use App\Models\DocumentVersion;
use Illuminate\Contracts\Support\Arrayable;
use JsonSerializable;

/**
 * One honest note about what did not survive normalization of an imported
 * snapshot (SPEC 5.2, §19 registry). Warnings never fail the import — they are
 * collected, persisted on the {@see DocumentVersion} as JSON, and
 * rendered as the author-facing warning list on the doc page.
 *
 * The shape is deliberately minimal and stable — `{ type, message }` — because it
 * crosses the API boundary to web/lib/document-types.ts by hand (accepted TS/PHP
 * duplication, TODOS). `type` is a machine-stable key; `message` is the
 * self-contained, author-readable sentence (the offending URL is folded in).
 *
 * @phpstan-type WarningArray array{type: string, message: string}
 */
final class ImportWarning implements Arrayable, JsonSerializable
{
    public const IMAGE_FETCH_FAILED = 'image_fetch_failed';

    public const IMAGE_BLOCKED = 'image_blocked';

    public const IMAGE_INVALID = 'image_invalid';

    public const HTML_CONVERSION_DEGRADED = 'html_conversion_degraded';

    private function __construct(
        public readonly string $type,
        public readonly string $message,
    ) {}

    /**
     * The fetch reached the origin but failed (timeout, 5xx, transport error).
     * The original URL is kept in the document so the image may still load.
     */
    public static function imageFetchFailed(string $url, string $reason): self
    {
        return new self(
            self::IMAGE_FETCH_FAILED,
            "Couldn't fetch image {$url} ({$reason}) — kept the original link.",
        );
    }

    /**
     * The image URL was refused by the SSRF guard (private/reserved address).
     */
    public static function imageBlocked(string $url): self
    {
        return new self(
            self::IMAGE_BLOCKED,
            "Image {$url} was blocked (points at a private address) — kept the original link.",
        );
    }

    /**
     * The bytes came back but weren't a usable image (not an image content type,
     * or an SVG that failed sanitization).
     */
    public static function imageInvalid(string $url, string $reason): self
    {
        return new self(
            self::IMAGE_INVALID,
            "Couldn't re-host image {$url} ({$reason}) — kept the original link.",
        );
    }

    /**
     * HTML→markdown conversion threw; the document degraded to recovered plain
     * text rather than failing the import (SPEC 5.2, §19).
     */
    public static function htmlConversionDegraded(string $reason): self
    {
        return new self(
            self::HTML_CONVERSION_DEGRADED,
            "This page couldn't be fully converted to markdown ({$reason}); showing recovered text.",
        );
    }

    /**
     * @return WarningArray
     */
    public function toArray(): array
    {
        return ['type' => $this->type, 'message' => $this->message];
    }

    /**
     * @return WarningArray
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
