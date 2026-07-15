<?php

namespace App\Services\Import\Normalization;

use enshrined\svgSanitize\Sanitizer;

/**
 * Sanitizes SVG bytes before they are re-hosted (SPEC 5.2, hard rule #2).
 *
 * Why a package and not a hand-rolled allowlist: an SVG is XML, and its script
 * surface is broad and easy to miss by hand — `<script>`, `on*` handlers,
 * `javascript:` in `href`/`xlink:href`, `<foreignObject>`, `<use>`/`<image>`
 * external references, and XML entity-expansion (billion-laughs / XXE) tricks.
 * enshrined/svg-sanitize is the maintained, purpose-built PHP SVG sanitizer
 * (the one WordPress plugins standardise on); it parses the SVG DOM against an
 * element/attribute allowlist and strips exactly that surface while preserving
 * the drawing. A generic HTML sanitizer (symfony/html-sanitizer, used for the
 * HTML→markdown path) is not SVG/namespace-aware and would gut the graphic, so
 * the two live side by side.
 *
 * Re-hosted SVGs are served from the media disk and rendered via `<img src>`,
 * where the browser already runs them inert (no scripts, no external fetches);
 * sanitizing on the way in is defence in depth so the stored asset is safe even
 * if opened directly. `removeRemoteReferences(true)` strips remote `url()`/`use`
 * refs; a residual namespaced `xlink:href` on `<image>` can survive the
 * library's removal (a known enshrined quirk), but it is inert in `<img>` render
 * mode — the XSS-critical surface (scripts, handlers, `javascript:` hrefs) is
 * always removed.
 */
class SvgSanitizer
{
    /**
     * Return sanitized SVG markup, or null if the input could not be parsed as
     * SVG at all (the caller keeps the original reference and warns).
     */
    public function sanitize(string $svg): ?string
    {
        $sanitizer = new Sanitizer;
        $sanitizer->removeRemoteReferences(true);
        $sanitizer->removeXMLTag(false);

        $clean = $sanitizer->sanitize($svg);

        return $clean === false ? null : $clean;
    }
}
