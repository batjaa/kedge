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
     * Max characters of Kroki's error body ever surfaced to the author or logged
     * (issue #56). A hard ceiling on untrusted text — a hostile diagram can make
     * Kroki spew, and this bounds it before it reaches a log line or a page.
     */
    private const MAX_DETAIL_CHARS = 500;

    /**
     * What the author sees when the failure is infrastructure, not their diagram
     * (Kroki down, timeout, unexpected client error). Deliberately generic — the
     * real message goes to the log, never to the page, so no internal endpoint,
     * host, or stack detail leaks (issue #56).
     */
    private const UNREACHABLE_DETAIL = 'diagram service unreachable';

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
            // No Accept header on purpose: the `/svg/` path already fixes the
            // SUCCESS format (Kroki always returns SVG here), while requesting
            // `image/svg+xml` would make Kroki answer a FAILURE with an SVG
            // "error card" whose human-readable reason is buried in <text>
            // markup — useless as a surfaced detail (issue #56). Omitting Accept
            // makes Kroki return the plain-text reason (e.g. mermaid "Error 400:
            // … No diagram type detected …") that authors can act on.
            $response = Http::connectTimeout((float) config('kedge.kroki.connect_timeout'))
                ->timeout((float) config('kedge.kroki.timeout'))
                ->get($url);
        } catch (ConnectionException $e) {
            // Infrastructure failure: the exception message is operator-only, so
            // the author gets a generic detail (no internal host/stack leaks).
            $this->fail($engine, 'unreachable', $e->getMessage(), self::UNREACHABLE_DETAIL);
        } catch (Throwable $e) {
            $this->fail($engine, 'error', $e->getMessage(), self::UNREACHABLE_DETAIL);
        }

        if (! $response->successful()) {
            // Kroki answers a bad-source diagram with a non-2xx and a plain-text
            // reason (e.g. mermaid "Parse error on line 2: …") — the ordinary
            // "this diagram won't render" path. Its body is UNTRUSTED (Kroki
            // parsed untrusted source), so we sanitize it before it becomes the
            // author's detail AND the log detail (issue #56).
            $detail = $this->sanitizeDetail($response->body());
            $this->fail($engine, 'http_'.$response->status(), $detail, $detail);
        }

        $svg = $response->body();

        if (strlen($svg) > (int) config('kedge.kroki.max_bytes')) {
            // Our own sanity cap, not anything the author can fix — no surfaced detail.
            $this->fail($engine, 'too_large', strlen($svg).' bytes');
        }

        if (! str_contains($svg, '<svg')) {
            // A 2xx body that isn't SVG is still Kroki telling us something the
            // author may act on — surface the sanitized body, same as a non-2xx.
            $detail = $this->sanitizeDetail($svg);
            $this->fail($engine, 'not_svg', $detail, $detail);
        }

        return $svg;
    }

    /**
     * Log `kroki.render_failed` (SPEC §19) and throw. Never lets the raw diagram
     * source into the log — only the engine, a short reason, and a short form of
     * the (already-sanitized) detail. `$publicDetail` is what the web may surface
     * beside the source (issue #56): Kroki's sanitized error body for a bad
     * diagram, a generic string for an infrastructure failure, or null when
     * nothing is safe or useful to show (the panel then renders exactly as before).
     *
     * @return never
     */
    private function fail(string $engine, string $reason, string $logDetail, ?string $publicDetail = null): void
    {
        Log::warning('kroki.render_failed', [
            'engine' => $engine,
            'reason' => $reason,
            'detail' => mb_substr($logDetail, 0, 200),
        ]);

        throw new DiagramRenderException(
            "Kroki render failed ({$reason}) for engine {$engine}.",
            $publicDetail,
        );
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

    /**
     * Reduce a Kroki error body to a short, single-line, plain-text detail safe
     * to log and to surface to the author (issue #56). Kroki processes UNTRUSTED
     * diagram source, so its response body is untrusted too: collapse all
     * whitespace to single spaces, strip any remaining control characters, and
     * hard-truncate. Never HTML — the web escapes it on render and the API
     * contract stays plain text.
     */
    private function sanitizeDetail(string $body): string
    {
        $collapsed = preg_replace('/\s+/', ' ', $body) ?? '';
        $stripped = preg_replace('/[\x00-\x1F\x7F]/', '', $collapsed) ?? '';

        return mb_substr(trim($stripped), 0, self::MAX_DETAIL_CHARS);
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('kedge.media.disk'));
    }
}
