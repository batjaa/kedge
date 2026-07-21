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
        if (str_starts_with($path, '/')) {
            $path = substr($path, 1);
        }

        return preg_match($this->toRegex($pattern), $path) === 1;
    }
}
