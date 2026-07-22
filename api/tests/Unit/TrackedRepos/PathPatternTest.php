<?php

namespace Tests\Unit\TrackedRepos;

use App\Services\TrackedRepos\PathPattern;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PathPatternTest extends TestCase
{
    #[DataProvider('pathPatternProvider')]
    public function test_it_matches_paths_using_pinned_pattern_semantics(
        string $pattern,
        string $path,
        bool $expected,
    ): void {
        $this->assertSame($expected, (new PathPattern)->matches($pattern, $path));
    }

    /**
     * @return iterable<string, array{string, string, bool}>
     */
    public static function pathPatternProvider(): iterable
    {
        yield 'star matches within one segment' => ['docs/*.md', 'docs/a.md', true];
        yield 'star does not cross a slash' => ['docs/*.md', 'docs/sub/a.md', false];

        yield 'recursive double star slash matches zero segments' => ['docs/**/*.md', 'docs/a.md', true];
        yield 'recursive double star slash matches one segment' => ['docs/**/*.md', 'docs/sub/a.md', true];
        yield 'recursive double star slash matches multiple segments' => ['docs/**/*.md', 'docs/x/y/a.md', true];

        yield 'leading recursive double star matches a root file' => ['**/*.md', 'README.md', true];
        yield 'leading recursive double star matches a nested file' => ['**/*.md', 'docs/a.md', true];

        yield 'trailing double star matches a direct child' => ['docs/**', 'docs/a.md', true];
        yield 'trailing double star matches a nested child' => ['docs/**', 'docs/x/y.md', true];
        yield 'trailing double star requires the preceding slash' => ['docs/**', 'docs', false];
        yield 'trailing double star requires the literal prefix' => ['docs/**', 'docsfile.md', false];

        yield 'middle double star slash matches zero segments' => ['a/**/b', 'a/b', true];
        yield 'middle double star slash matches one segment' => ['a/**/b', 'a/x/b', true];
        yield 'middle double star slash matches multiple segments' => ['a/**/b', 'a/x/y/b', true];
        yield 'middle double star remains whole-path anchored' => ['a/**/b', 'a/bc', false];

        yield 'question mark matches one character' => ['file?.md', 'fileA.md', true];
        yield 'question mark does not match zero characters' => ['file?.md', 'file.md', false];
        yield 'question mark does not match multiple characters' => ['file?.md', 'fileAB.md', false];
        yield 'question mark does not match a slash' => ['file?.md', 'file/.md', false];

        yield 'extension matching is case-sensitive at the root' => ['**/*.md', 'README.MD', false];
        yield 'extension matching is case-sensitive when nested' => ['**/*.md', 'docs/A.MD', false];
        yield 'literal prefix preserves case' => ['Docs/*.md', 'Docs/a.md', true];
        yield 'literal prefix rejects different case' => ['Docs/*.md', 'docs/a.md', false];

        yield 'dot is matched literally in an extension' => ['*.md', 'a.md', true];
        yield 'dot does not act as a regex wildcard' => ['*.md', 'axmd', false];
        yield 'dot is literal without wildcard syntax' => ['a.b', 'a.b', true];
        yield 'literal dot rejects another character' => ['a.b', 'axb', false];

        yield 'plain pattern matches the exact path' => ['docs/SPEC.md', 'docs/SPEC.md', true];
        yield 'plain pattern rejects an added prefix' => ['docs/SPEC.md', 'x/docs/SPEC.md', false];
        yield 'plain pattern rejects an added suffix' => ['docs/SPEC.md', 'docs/SPEC.md.bak', false];
        yield 'plain pattern rejects a different path' => ['docs/SPEC.md', 'docs/OTHER.md', false];

        yield 'one leading slash on a candidate is tolerated' => ['*.md', '/a.md', true];

        // A rooted pattern (leading slash = "from the repo root") must normalize the
        // same way the candidate does — otherwise the anchored regex demands a
        // leading slash the repo-relative tree path never carries and matches nothing.
        yield 'leading slash on the pattern matches a root file' => ['/docs/*.md', 'docs/a.md', true];
        yield 'leading slash on the pattern still respects segments' => ['/docs/*.md', 'docs/sub/a.md', false];
        yield 'leading slash on the pattern with double star' => ['/docs/**/*.md', 'docs/x/y/a.md', true];
        yield 'leading slash on both pattern and candidate' => ['/docs/*.md', '/docs/a.md', true];
        yield 'rooted single-segment glob matches a root file' => ['/*.md', 'README.md', true];
    }
}
