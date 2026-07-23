<?php

namespace App\Services\TrackedRepos;

/**
 * Translates and matches gitignore-style path patterns per SPEC §16 decision 9A.
 */
final class PathPattern
{
    public function toRegex(string $pattern): string
    {
        $regex = '';
        $length = strlen($pattern);

        for ($index = 0; $index < $length; $index++) {
            $character = $pattern[$index];

            if ($character === '*') {
                if ($index + 1 < $length && $pattern[$index + 1] === '*') {
                    if ($index + 2 < $length && $pattern[$index + 2] === '/') {
                        $regex .= '(?:[^/]+/)*';
                        $index += 2;
                    } else {
                        $regex .= '.*';
                        $index++;
                    }

                    continue;
                }

                $regex .= '[^/]*';

                continue;
            }

            if ($character === '?') {
                $regex .= '[^/]';

                continue;
            }

            // `~` is the delimiter (not `/`): the emitted `[^/]` classes carry a
            // literal slash, so a `/` delimiter would close the pattern early.
            $regex .= preg_quote($character, '~');
        }

        return '~\A'.$regex.'\z~';
    }

    public function matches(string $pattern, string $path): bool
    {
        // Normalize a leading slash off BOTH sides: git tree paths are repo-relative
        // with no leading slash, but an author naturally writes `/docs/*.md` to mean
        // "from the repo root". Stripping only the candidate (not the pattern) left
        // the anchored regex demanding a leading slash the path never has, so a
        // rooted pattern silently matched nothing.
        $pattern = ltrim($pattern, '/');
        $path = ltrim($path, '/');

        return preg_match($this->toRegex($pattern), $path) === 1;
    }
}
