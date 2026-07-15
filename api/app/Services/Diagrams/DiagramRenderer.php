<?php

namespace App\Services\Diagrams;

use App\Services\Diagrams\Exceptions\DiagramRenderException;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * The API-mediated Kroki render cache (SPEC §6.2). The web's diagram component
 * calls the internal endpoint once per diagram during server render; this
 * service turns an (engine, source) into a cached SVG on the media disk and
 * returns its public /storage URL. Readers then fetch a static <img> and never
 * contact Kroki.
 *
 * ── What keys the cache ──────────────────────────────────────────────────────
 * Content-addressed by (engine, sha256(source)) at path
 * `diagrams/{engine}/{hash}.svg` on the media disk — NOT scoped to a document or
 * version, so the same diagram re-used across documents and across a document's
 * versions renders exactly once and every later request is a disk hit that never
 * touches Kroki.
 *
 * ── Trust boundary ───────────────────────────────────────────────────────────
 * Kroki is a trusted, operator-configured internal service (KROKI_URL; the
 * self-host compose points it at http://kroki:8000), so its render call uses the
 * HTTP client DIRECTLY with size/timeout caps — deliberately NOT the SSRF guard,
 * whose https-only + private-IP blocking would reject the internal container.
 *
 * The SVG is stored as Kroki emits it and embedded via <img> — the security
 * boundary SPEC §6.2 relies on: a browser never runs scripts or fetches external
 * resources for an <img>-referenced SVG, so the in-browser diagram-parser XSS
 * class is eliminated for readers regardless of source. We deliberately do NOT
 * run the SVG sanitizer here (that is for arbitrary uploaded images): Kroki is
 * the sole trusted renderer (hard rule #3) and its mermaid output carries node
 * labels in <foreignObject> HTML — the exact element an SVG sanitizer strips,
 * which would blank every mermaid label. The `<img>` boundary is the guarantee.
 */
class DiagramRenderer
{
    /**
     * Return the public URL of the cached SVG for this diagram, rendering it via
     * Kroki on a cache miss. The engine MUST already be allowlisted (the caller
     * checks {@see DiagramEngines}); this method assumes it and never forwards an
     * unknown engine.
     *
     * @throws DiagramRenderException Kroki failed, or the source is too large.
     */
    public function render(string $engine, string $source): string
    {
        $maxSource = (int) config('kedge.kroki.max_source_bytes');
        if (strlen($source) > $maxSource) {
            throw new DiagramRenderException("Diagram source exceeds {$maxSource} bytes.");
        }

        $disk = $this->disk();
        $path = "diagrams/{$engine}/".hash('sha256', $source).'.svg';

        // Cache hit: the SVG for this exact (engine, source) already exists — hand
        // back its URL without ever calling Kroki.
        if ($disk->exists($path)) {
            return $disk->url($path);
        }

        $svg = $this->fetchFromKroki($engine, $source);
        $disk->put($path, $svg);

        Log::info('kroki.rendered', ['engine' => $engine, 'path' => $path, 'bytes' => strlen($svg)]);

        return $disk->url($path);
    }

    /**
     * Render one diagram through Kroki's GET API and return sanitized SVG bytes.
     *
     * @throws DiagramRenderException
     */
    private function fetchFromKroki(string $engine, string $source): string
    {
        $url = config('kedge.kroki.url')."/{$engine}/svg/".$this->encode($source);

        try {
            $response = Http::connectTimeout((float) config('kedge.kroki.connect_timeout'))
                ->timeout((float) config('kedge.kroki.timeout'))
                ->withHeaders(['Accept' => 'image/svg+xml'])
                ->get($url);
        } catch (ConnectionException $e) {
            $this->fail($engine, 'unreachable', $e->getMessage());
        } catch (Throwable $e) {
            $this->fail($engine, 'error', $e->getMessage());
        }

        if (! $response->successful()) {
            // Kroki answers a bad-source diagram with a non-2xx and a plain-text
            // reason — the ordinary "this diagram won't render" path.
            $this->fail($engine, 'http_'.$response->status(), $this->reason($response->body()));
        }

        $svg = $response->body();

        if (strlen($svg) > (int) config('kedge.kroki.max_bytes')) {
            $this->fail($engine, 'too_large', strlen($svg).' bytes');
        }

        if (! str_contains($svg, '<svg')) {
            $this->fail($engine, 'not_svg', $this->reason($svg));
        }

        return $svg;
    }

    /**
     * Log `kroki.render_failed` (SPEC §19) and throw. Never lets the raw diagram
     * source into the log — only the engine and a short reason.
     *
     * @return never
     */
    private function fail(string $engine, string $reason, string $detail): void
    {
        Log::warning('kroki.render_failed', [
            'engine' => $engine,
            'reason' => $reason,
            'detail' => mb_substr($detail, 0, 200),
        ]);

        throw new DiagramRenderException("Kroki render failed ({$reason}) for engine {$engine}.");
    }

    /**
     * Kroki GET payload encoding (SPEC §6.2): zlib-compress (RFC 1950 — this is
     * gzcompress, matching the web's zlib.deflateSync, NOT the header-less
     * gzdeflate), then URL-safe base64. Kroki inflates with pako, which requires
     * the zlib header.
     */
    private function encode(string $source): string
    {
        return rtrim(strtr(base64_encode(gzcompress($source, 9)), '+/', '-_'), '=');
    }

    /** A short, single-line snippet of a Kroki error body for the log detail. */
    private function reason(string $body): string
    {
        return trim(preg_replace('/\s+/', ' ', $body) ?? '');
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('kedge.media.disk'));
    }
}
