<?php

namespace App\Services\Comments;

use App\Enums\AnchorState;
use App\Models\Anchor;
use App\Models\DocumentVersion;

final class AnchorAttributes
{
    private const SELECTOR_FIELDS = [
        'exact',
        'prefix',
        'suffix',
        'start',
        'end',
        'heading_path',
        'projection_version',
    ];

    /**
     * @param  array<string, mixed>  $anchor
     * @return array<string, mixed>
     */
    public static function fromCapture(array $anchor, DocumentVersion $version): array
    {
        return [
            'document_version_id' => $version->id,
            ...self::selectorAttributes($anchor),
            'state' => AnchorState::Anchored,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function fromAnchor(Anchor $anchor): array
    {
        return [
            'document_version_id' => $anchor->document_version_id,
            ...self::selectorAttributes([
                'exact' => $anchor->exact,
                'prefix' => $anchor->prefix,
                'suffix' => $anchor->suffix,
                'start' => $anchor->start,
                'end' => $anchor->end,
                'heading_path' => $anchor->heading_path,
                'projection_version' => $anchor->projection_version,
            ]),
            'state' => $anchor->state,
        ];
    }

    /**
     * @param  array<string, mixed>  $source
     * @return array<string, mixed>
     */
    private static function selectorAttributes(array $source): array
    {
        $attributes = [];

        foreach (self::SELECTOR_FIELDS as $field) {
            $attributes[$field] = $source[$field] ?? null;
        }

        return $attributes;
    }
}
