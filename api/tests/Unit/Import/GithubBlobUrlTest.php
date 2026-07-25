<?php

namespace Tests\Unit\Import;

use App\Services\Import\GithubBlobUrl;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Direct coverage of the one place a GitHub blob URL is interpreted (M3.10 #116).
 * The connectors and provenance derivation both delegate here, so the parse matrix
 * — plain and nested paths, URL-encoded segments, branch/tag/SHA refs, and every
 * non-blob or malformed shape → null — is asserted against the parser itself
 * rather than only through the import fetch path.
 */
final class GithubBlobUrlTest extends TestCase
{
    #[DataProvider('blobUrlProvider')]
    public function test_it_parses_blob_urls_into_owner_repo_ref_and_path(
        string $url,
        string $owner,
        string $repo,
        string $ref,
        string $path,
    ): void {
        $blob = GithubBlobUrl::fromUrl($url);

        $this->assertNotNull($blob);
        $this->assertSame($owner, $blob->owner);
        $this->assertSame($repo, $blob->repo);
        $this->assertSame($ref, $blob->ref);
        $this->assertSame($path, $blob->path);
    }

    /**
     * @return iterable<string, array{string, string, string, string, string}>
     */
    public static function blobUrlProvider(): iterable
    {
        yield 'plain path on a branch ref' => [
            'https://github.com/octocat/Hello-World/blob/master/README.md',
            'octocat', 'Hello-World', 'master', 'README.md',
        ];

        yield 'nested path' => [
            'https://github.com/kedgehq/kedge/blob/main/docs/specs/m1-import-render.md',
            'kedgehq', 'kedge', 'main', 'docs/specs/m1-import-render.md',
        ];

        yield 'www host and a tag ref' => [
            'https://www.github.com/o/r/blob/v1.2.3/path/to/file.mdx',
            'o', 'r', 'v1.2.3', 'path/to/file.mdx',
        ];

        yield 'a full commit SHA ref' => [
            'https://github.com/o/r/blob/0a1b2c3d4e5f60718293a4b5c6d7e8f901234567/a.md',
            'o', 'r', '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567', 'a.md',
        ];

        yield 'host is matched case-insensitively' => [
            'https://GitHub.com/o/r/blob/main/a.md',
            'o', 'r', 'main', 'a.md',
        ];

        yield 'url-encoded path segments are decoded (space and hash)' => [
            'https://github.com/kedgehq/kedge/blob/main/docs/RFC%20%2312.md',
            'kedgehq', 'kedge', 'main', 'docs/RFC #12.md',
        ];

        yield 'url-encoded ref is decoded' => [
            'https://github.com/o/r/blob/release%20candidate/a.md',
            'o', 'r', 'release candidate', 'a.md',
        ];

        yield 'a slash-containing ref takes the legacy first-segment split' => [
            'https://github.com/o/r/blob/feature/x/docs/a.md',
            'o', 'r', 'feature', 'x/docs/a.md',
        ];
    }

    #[DataProvider('nonBlobUrlProvider')]
    public function test_it_returns_null_for_non_blob_and_malformed_urls(string $url): void
    {
        $this->assertNull(GithubBlobUrl::fromUrl($url));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function nonBlobUrlProvider(): iterable
    {
        yield 'repo root is not a file' => ['https://github.com/octocat/Hello-World'];
        yield 'tree view is not a blob' => ['https://github.com/octocat/Hello-World/tree/master/docs'];
        yield 'issues path is not a blob' => ['https://github.com/octocat/Hello-World/issues/1'];
        yield 'blob with a ref but no path segment' => ['https://github.com/o/r/blob/main'];
        yield 'raw host is a different host' => ['https://raw.githubusercontent.com/octocat/Hello-World/master/README.md'];
        yield 'gist host is not github.com' => ['https://gist.github.com/octocat/abc123'];
        yield 'an unrelated host that mimics the blob shape' => ['https://example.com/octocat/Hello-World/blob/master/README.md'];
        yield 'host but no path' => ['https://github.com'];
        yield 'missing scheme leaves no host to match' => ['github.com/o/r/blob/main/a.md'];
        yield 'not a url at all' => ['garbage'];
        yield 'empty string' => [''];
    }
}
