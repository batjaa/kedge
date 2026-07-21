<?php

namespace App\Services\Reanchor;

use App\Services\Reanchor\Exceptions\ReanchorRequestException;
use App\Services\Reanchor\Exceptions\ReanchorUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Client for the web layer's internal re-anchoring endpoint. The matcher
 * lives beside the web projection/capture code so Kedge has one anchor language.
 */
class ReanchorClient
{
    /**
     * @param  list<array{threadId: int, exact: string, prefix: ?string, suffix: ?string, start: int, end: int}>  $anchors
     * @return list<array{threadId: int, state: string, exact: string, prefix: ?string, suffix: ?string, start: int, end: int}>
     */
    public function reanchor(array $anchors, string $newPlainText): array
    {
        if ($anchors === []) {
            return [];
        }

        $endpoint = config('kedge.reanchor.url').'/internal/reanchor';

        try {
            $response = Http::withHeaders([
                'x-projection-secret' => (string) config('kedge.reanchor.secret'),
            ])
                ->timeout((float) config('kedge.reanchor.timeout'))
                ->acceptJson()
                ->asJson()
                ->post($endpoint, [
                    'anchors' => $anchors,
                    'newPlainText' => $newPlainText,
                ]);
        } catch (ConnectionException $e) {
            throw new ReanchorUnavailableException(
                'Re-anchor endpoint unreachable: '.$e->getMessage(),
                previous: $e,
            );
        }

        if ($response->clientError()) {
            throw new ReanchorRequestException(
                "Re-anchor endpoint rejected the request with HTTP {$response->status()}.",
            );
        }

        if (! $response->successful()) {
            throw new ReanchorUnavailableException(
                "Re-anchor endpoint returned HTTP {$response->status()}.",
            );
        }

        $data = $response->json();
        if (! is_array($data) || ! array_key_exists('results', $data) || ! is_array($data['results'])) {
            throw new ReanchorUnavailableException('Re-anchor endpoint returned a malformed body.');
        }

        return $this->validatedResults($data['results']);
    }

    /**
     * @param  array<int, mixed>  $results
     * @return list<array{threadId: int, state: string, exact: string, prefix: ?string, suffix: ?string, start: int, end: int}>
     */
    private function validatedResults(array $results): array
    {
        $validated = [];

        foreach ($results as $result) {
            if (! is_array($result)) {
                throw new ReanchorUnavailableException('Re-anchor endpoint returned a malformed result.');
            }

            $threadId = $result['threadId'] ?? null;
            $state = $result['state'] ?? null;
            $exact = $result['exact'] ?? null;
            $start = $result['start'] ?? null;
            $end = $result['end'] ?? null;

            if (
                ! is_int($threadId)
                || ! in_array($state, ['anchored', 'relocated', 'orphaned'], true)
                || ! is_string($exact)
                || ! is_int($start)
                || ! is_int($end)
            ) {
                throw new ReanchorUnavailableException('Re-anchor endpoint returned a malformed result.');
            }

            $prefix = $result['prefix'] ?? null;
            $suffix = $result['suffix'] ?? null;
            if (($prefix !== null && ! is_string($prefix)) || ($suffix !== null && ! is_string($suffix))) {
                throw new ReanchorUnavailableException('Re-anchor endpoint returned a malformed result.');
            }

            $validated[] = [
                'threadId' => $threadId,
                'state' => $state,
                'exact' => $exact,
                'prefix' => $prefix,
                'suffix' => $suffix,
                'start' => $start,
                'end' => $end,
            ];
        }

        return $validated;
    }
}
