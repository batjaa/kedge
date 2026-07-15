<?php

namespace App\Services\Import;

use App\Enums\DocumentFormat;
use App\Services\Import\Exceptions\ProjectionFailedException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Client for the web layer's internal text-projection endpoint (SPEC §5.4). The
 * web owns projection because it owns rendering — one pipeline defines both what
 * a reader sees and what a comment anchors to — so the import job calls out here
 * rather than re-implementing a projection in PHP (which would silently drift).
 *
 * The endpoint is internal and shared-secret guarded; this client presents the
 * secret on every request. Any failure — unreachable, timeout, non-2xx, or a
 * malformed body — is a transient {@see ProjectionFailedException}, so a version
 * is never stored without its anchor substrate (SPEC §5.4, §19).
 */
class TextProjector
{
    public function project(string $content, DocumentFormat $format): ProjectionResult
    {
        $endpoint = config('kedge.projection.url').'/internal/projection';

        try {
            $response = Http::withHeaders([
                'x-projection-secret' => (string) config('kedge.projection.secret'),
            ])
                ->timeout((float) config('kedge.projection.timeout'))
                ->acceptJson()
                ->asJson()
                ->post($endpoint, [
                    'content' => $content,
                    'format' => $format->value,
                ]);
        } catch (ConnectionException $e) {
            throw new ProjectionFailedException(
                'Projection endpoint unreachable: '.$e->getMessage(),
                previous: $e,
            );
        }

        if (! $response->successful()) {
            throw new ProjectionFailedException(
                "Projection endpoint returned HTTP {$response->status()}.",
            );
        }

        $data = $response->json();

        if (! is_array($data)
            || ! array_key_exists('plain_text', $data)
            || ! array_key_exists('projection_version', $data)) {
            throw new ProjectionFailedException('Projection endpoint returned a malformed body.');
        }

        return new ProjectionResult(
            plainText: (string) $data['plain_text'],
            projectionVersion: (string) $data['projection_version'],
            mdxOk: (bool) ($data['mdx_ok'] ?? true),
            warnings: array_values(array_filter(
                (array) ($data['warnings'] ?? []),
                'is_string',
            )),
        );
    }
}
