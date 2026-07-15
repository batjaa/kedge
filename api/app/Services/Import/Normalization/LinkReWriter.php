<?php

namespace App\Services\Import\Normalization;

use GuzzleHttp\Psr7\Uri;
use GuzzleHttp\Psr7\UriResolver;
use Psr\Http\Message\UriInterface;
use Throwable;

/**
 * Absolutizes relative link hrefs in an imported document's markdown against the
 * document's source URL (issue #50). A doc imported from
 * `github.com/o/r/blob/main/docs/rfc.md` that writes `[other](./other.md)` would
 * otherwise render an href that resolves against the Kedge origin and 404s; here
 * it becomes `github.com/o/r/blob/main/docs/other.md` — a sibling of the source,
 * which Kedge can itself import.
 *
 * The base for resolution is the connector's `finalUrl` (SPEC 5.1): the human
 * blob URL for GitHub sources (so siblings resolve to blob URLs) and the
 * post-redirect URL for raw sources (so siblings resolve to raw siblings). A
 * pasted/uploaded document has no source URL — its base is empty and every href
 * is left exactly as authored.
 *
 * What is left untouched:
 *   - absolute URLs (any scheme: `https:`, `http:`, `mailto:`, `tel:`, `ftp:`, …)
 *     — a scheme means the target is self-locating, never relative;
 *   - protocol-relative hrefs (`//host/path`) — already host-absolute;
 *   - pure fragments (`#section`) — in-page anchors the reader resolves;
 *   - anything, when there is no base URL (pasted/uploaded docs).
 *
 * Root-relative hrefs (`/docs/x.md`) resolve against the source's ORIGIN per
 * RFC 3986 (`UriResolver`): `/docs/x.md` on a GitHub blob source becomes
 * `github.com/docs/x.md`. That is the standard meaning of a leading-slash path
 * and matches how a browser viewing the raw source would resolve it.
 *
 * Kedge-internal linking (pointing a link at the target document's page inside
 * Kedge when it too has been imported) is deliberately NOT attempted — that is
 * the post-v1 Project concept (CONTEXT.md); this pass only fixes the href so it
 * points back at a real, importable source location.
 *
 * ## Ordering vs {@see ImageReHoster}
 *
 * This runs AFTER image re-hosting in the {@see Normalizer} pipeline, and the two
 * passes are non-overlapping by construction:
 *   - {@see ImageReHoster} matches ONLY inline images `![alt](url)` — every match
 *     is anchored on the leading `!`.
 *   - This pass matches links `[text](url)` (with a negative lookbehind on `!`, so
 *     an image is never mistaken for a link) and reference-style definitions
 *     `[label]: url`, which images never touch.
 * An image used as a link's content — `[![alt](img)](./page.md)`, the common badge
 * idiom — composes cleanly: the inner image is re-hosted first, then this pass
 * absolutizes only the OUTER link's href, carrying the already-rewritten image
 * through verbatim. Order is therefore immaterial to correctness; links run last
 * only for readability.
 *
 * Like {@see ImageReHoster} this operates on the markdown text with a pragmatic
 * regex rather than a full CommonMark parse: link text with unbalanced brackets,
 * and links/definitions written INSIDE fenced code blocks, are out of reach (same
 * accepted limitation as image re-hosting).
 */
class LinkReWriter
{
    /**
     * Inline link `[text](url "optional title")`, excluding images.
     *
     *   - `(?<!!)` — a leading `!` makes it an image ({@see ImageReHoster}'s job),
     *     never a link.
     *   - `text` — non-bracket runs OR a whole nested inline image, so an
     *     image-as-link (`[![alt](img)](url)`) keeps its inner image intact. The
     *     atomic group `(?>…)` forecloses backtracking on untrusted input (no
     *     catastrophic-regex hang — hard rule #2).
     *   - `url` — a `<…>`-wrapped run or a bare run of non-space, non-`)` chars.
     *   - `title` — an optional quoted/parenthesised title, preserved verbatim.
     */
    private const LINK_PATTERN = '/(?<!!)\[(?<text>(?>(?:!\[[^\]]*\]\([^)]*\)|[^\[\]])*))\]\(\s*(?<url><[^>]+>|[^\s)]+)(?<title>\s+(?:"[^"]*"|\'[^\']*\'|\([^)]*\)))?\s*\)/';

    /**
     * Reference-style link definition on its own line: up to three spaces of
     * indent, `[label]:`, the URL (optionally `<…>`-wrapped), and an optional
     * same-line title. A label cannot be empty or contain `]`.
     */
    private const REFERENCE_DEFINITION_PATTERN = '/^(?<indent> {0,3})\[(?<label>[^\]\n]+)\]:[ \t]*(?<url><[^>]+>|\S+)(?<title>[ \t]+(?:"[^"]*"|\'[^\']*\'|\([^)]*\)))?[ \t]*$/m';

    /**
     * Rewrite every relative link href in the markdown to an absolute URL rooted
     * at the document's source. A pasted/uploaded document (empty base) and
     * PCRE failure both return the input unchanged.
     *
     * @param  string  $baseUrl  The document's final URL (connector `finalUrl`).
     */
    public function rewrite(string $markdown, string $baseUrl): string
    {
        if ($baseUrl === '') {
            // No source URL (pasted/uploaded): nothing to resolve against — leave
            // every href exactly as authored.
            return $markdown;
        }

        try {
            $base = new Uri($baseUrl);
        } catch (Throwable) {
            return $markdown;
        }

        $rewritten = preg_replace_callback(
            self::LINK_PATTERN,
            fn (array $m): string => $this->rewriteInline($m, $base),
            $markdown,
        );
        $markdown = $rewritten ?? $markdown;

        $rewritten = preg_replace_callback(
            self::REFERENCE_DEFINITION_PATTERN,
            fn (array $m): string => $this->rewriteDefinition($m, $base),
            $markdown,
        );

        return $rewritten ?? $markdown;
    }

    /**
     * @param  array<string, string>  $m  Named groups from LINK_PATTERN.
     */
    private function rewriteInline(array $m, UriInterface $base): string
    {
        $absolute = $this->absolutize($this->rawUrl($m['url']), $base);
        if ($absolute === null) {
            return $m[0];
        }

        $title = $m['title'] ?? '';

        return "[{$m['text']}]({$this->wrap($m['url'], $absolute)}{$title})";
    }

    /**
     * @param  array<string, string>  $m  Named groups from REFERENCE_DEFINITION_PATTERN.
     */
    private function rewriteDefinition(array $m, UriInterface $base): string
    {
        $absolute = $this->absolutize($this->rawUrl($m['url']), $base);
        if ($absolute === null) {
            return $m[0];
        }

        $title = $m['title'] ?? '';

        return "{$m['indent']}[{$m['label']}]: {$this->wrap($m['url'], $absolute)}{$title}";
    }

    /**
     * Resolve a possibly-relative href against the base, or null to leave it as-is
     * (absolute, protocol-relative, fragment, empty, or unresolvable).
     */
    private function absolutize(string $href, UriInterface $base): ?string
    {
        if ($href === '' || str_starts_with($href, '#') || str_starts_with($href, '//')) {
            return null;
        }

        // A scheme (http:, mailto:, tel:, …) means the target locates itself; only
        // schemeless references are relative to the source.
        if (parse_url($href, PHP_URL_SCHEME) !== null) {
            return null;
        }

        try {
            return (string) UriResolver::resolve($base, new Uri($href));
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The href with any `<…>` wrapping stripped, ready to resolve.
     */
    private function rawUrl(string $token): string
    {
        $token = trim($token);

        return str_starts_with($token, '<') ? trim($token, '<>') : $token;
    }

    /**
     * Re-wrap the resolved URL in `<…>` when the original token was wrapped, so a
     * URL carrying spaces stays valid markdown.
     */
    private function wrap(string $originalToken, string $url): string
    {
        return str_starts_with(trim($originalToken), '<') ? "<{$url}>" : $url;
    }
}
