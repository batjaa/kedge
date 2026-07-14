<?php

namespace App\Services\Import;

use Illuminate\Support\Str;

/**
 * Gives an imported document a sensible title without hand-edited frontmatter
 * (SPEC 5.2; spike finding, TODOS 2026-07-03). Order of preference:
 *
 *   1. a `title:` in YAML frontmatter,
 *   2. the first `# ` ATX heading,
 *   3. the source filename, humanized,
 *   4. "Untitled document".
 */
class TitleSynthesizer
{
    private const MAX_LENGTH = 255;

    /**
     * Best title for the given normalized content, falling back to the URL.
     */
    public function fromContent(string $content, string $url): string
    {
        return $this->clamp(
            $this->frontmatterTitle($content)
                ?? $this->firstHeading($content)
                ?? $this->filenameFrom($url)
        );
    }

    /**
     * A placeholder title from the URL alone — used when the document row is
     * created, before its content has been fetched.
     */
    public function filenameFrom(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $base = basename($path);

        // Drop a document extension; humanize slugs and snake/kebab case.
        $base = (string) preg_replace('/\.(md|mdx|markdown|html?|txt)$/i', '', $base);
        $base = trim(str_replace(['-', '_'], ' ', rawurldecode($base)));

        return $this->clamp($base !== '' ? Str::title($base) : 'Untitled document');
    }

    private function frontmatterTitle(string $content): ?string
    {
        if (! preg_match('/\A---\R(.*?)\R---\R/s', $content, $block)) {
            return null;
        }

        if (! preg_match('/^title:\s*(.+?)\s*$/mi', $block[1], $m)) {
            return null;
        }

        $title = trim($m[1], " \t\"'");

        return $title !== '' ? $title : null;
    }

    private function firstHeading(string $content): ?string
    {
        foreach (preg_split('/\R/', $content) ?: [] as $line) {
            if (preg_match('/^\s{0,3}#\s+(.+?)\s*#*\s*$/', $line, $m)) {
                return trim($m[1]);
            }
        }

        return null;
    }

    private function clamp(string $title): string
    {
        return Str::limit($title, self::MAX_LENGTH, '');
    }
}
