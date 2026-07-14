<?php

namespace Tests\Unit\Import\Normalization;

use App\Models\Document;
use App\Services\Fetch\BlockReason;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Normalization\ImageReHoster;
use App\Services\Import\Normalization\ImportWarning;
use App\Services\Import\Normalization\SvgSanitizer;
use Illuminate\Support\Facades\Storage;
use Mockery;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * Image re-hosting (SPEC 5.2, §19): referenced images are fetched through the
 * guarded fetcher, stored on the media disk, and their URLs rewritten — while
 * every failed fetch becomes a warning and leaves the original URL in place so
 * the import continues. The one external seam (the fetcher) is faked; storage is
 * an in-memory fake disk.
 */
class ImageReHosterTest extends TestCase
{
    /**
     * A re-hoster whose fetches are routed by a callback (url → FetchResult, or
     * throw). Extra fetch arguments (the size cap) are ignored by the callback.
     */
    private function rehoster(callable $route): ImageReHoster
    {
        $fetcher = Mockery::mock(GuardedFetcher::class);
        $fetcher->shouldReceive('fetch')->andReturnUsing($route);

        return new ImageReHoster($fetcher, new SvgSanitizer);
    }

    private function document(int $id = 42): Document
    {
        $document = new Document;
        $document->id = $id;

        return $document;
    }

    #[Test]
    public function it_rehosts_an_absolute_image_and_rewrites_the_url(): void
    {
        Storage::fake('public');
        $bytes = 'PNGBYTES';
        $rehoster = $this->rehoster(fn (string $url) => new FetchResult(200, $bytes, 'image/png', $url));

        [$out, $warnings] = $rehoster->rehost(
            '![alt](https://cdn.example.com/pic.png)',
            $this->document(),
            'https://blog.example.com/post',
        );

        $this->assertSame([], $warnings);
        $path = 'media/42/'.hash('sha256', $bytes).'.png';
        Storage::disk('public')->assertExists($path);
        $this->assertStringContainsString('/storage/'.$path, $out);
        $this->assertStringNotContainsString('cdn.example.com', $out);
        // alt text is preserved through the rewrite.
        $this->assertStringStartsWith('![alt](', $out);
    }

    #[Test]
    public function it_resolves_a_relative_image_against_the_base_url(): void
    {
        Storage::fake('public');
        $captured = null;
        $rehoster = $this->rehoster(function (string $url) use (&$captured) {
            $captured = $url;

            return new FetchResult(200, 'GIF', 'image/gif', $url);
        });

        [$out] = $rehoster->rehost(
            '![logo](/assets/logo.gif)',
            $this->document(),
            'https://blog.example.com/2026/post.html',
        );

        $this->assertSame('https://blog.example.com/assets/logo.gif', $captured);
        Storage::disk('public')->assertExists('media/42/'.hash('sha256', 'GIF').'.gif');
        $this->assertStringNotContainsString('](/assets/logo.gif)', $out);
    }

    #[Test]
    public function a_blocked_image_becomes_a_warning_and_keeps_the_original_url(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(function (string $url) {
            throw new BlockedUrlException(BlockReason::PrivateAddress, 'private range');
        });

        [$out, $warnings] = $rehoster->rehost(
            '![x](https://169.254.169.254/secret.png)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertCount(1, $warnings);
        $this->assertSame(ImportWarning::IMAGE_BLOCKED, $warnings[0]->type);
        // Original URL untouched — the import continues.
        $this->assertStringContainsString('![x](https://169.254.169.254/secret.png)', $out);
        $this->assertEmpty(Storage::disk('public')->allFiles('media/42'));
    }

    #[Test]
    public function an_unreachable_image_becomes_a_warning_and_keeps_the_original_url(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(function (string $url) {
            throw new UpstreamFetchException('connection reset');
        });

        [$out, $warnings] = $rehoster->rehost(
            '![x](https://cdn.example.com/pic.png)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertSame(ImportWarning::IMAGE_FETCH_FAILED, $warnings[0]->type);
        $this->assertStringContainsString('https://cdn.example.com/pic.png', $out);
    }

    #[Test]
    public function a_non_2xx_image_response_becomes_a_warning(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(fn (string $url) => new FetchResult(404, '', 'text/html', $url));

        [$out, $warnings] = $rehoster->rehost(
            '![x](https://cdn.example.com/gone.png)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertCount(1, $warnings);
        $this->assertSame(ImportWarning::IMAGE_FETCH_FAILED, $warnings[0]->type);
        $this->assertStringContainsString('https://cdn.example.com/gone.png', $out);
    }

    #[Test]
    public function a_non_image_response_becomes_a_warning(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(fn (string $url) => new FetchResult(200, '<html>gotcha</html>', 'text/html', $url));

        [$out, $warnings] = $rehoster->rehost(
            '![x](https://cdn.example.com/notreally)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertCount(1, $warnings);
        $this->assertSame(ImportWarning::IMAGE_INVALID, $warnings[0]->type);
        $this->assertEmpty(Storage::disk('public')->allFiles('media/42'));
    }

    #[Test]
    public function it_sanitizes_svg_bytes_before_storing_them(): void
    {
        Storage::fake('public');
        $hostile = (string) file_get_contents(__DIR__.'/../../../Fixtures/normalization/hostile.svg');
        $rehoster = $this->rehoster(fn (string $url) => new FetchResult(200, $hostile, 'image/svg+xml', $url));

        [$out] = $rehoster->rehost(
            '![diagram](https://cdn.example.com/diagram.svg)',
            $this->document(),
            'https://base.example.com/',
        );

        $files = Storage::disk('public')->allFiles('media/42');
        $this->assertCount(1, $files);
        $this->assertStringEndsWith('.svg', $files[0]);

        $stored = Storage::disk('public')->get($files[0]);
        $this->assertStringNotContainsStringIgnoringCase('<script', $stored);
        $this->assertStringNotContainsString('onload', $stored);
        $this->assertStringContainsString('<circle', $stored);
        $this->assertStringContainsString('/storage/media/42/', $out);
    }

    #[Test]
    public function an_unsanitizable_svg_becomes_a_warning(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(fn (string $url) => new FetchResult(200, "\x00 not svg", 'image/svg+xml', $url));

        [$out, $warnings] = $rehoster->rehost(
            '![x](https://cdn.example.com/broken.svg)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertCount(1, $warnings);
        $this->assertSame(ImportWarning::IMAGE_INVALID, $warnings[0]->type);
        $this->assertEmpty(Storage::disk('public')->allFiles('media/42'));
    }

    #[Test]
    public function it_leaves_data_uris_untouched_and_never_fetches_them(): void
    {
        Storage::fake('public');
        $rehoster = $this->rehoster(function (string $url) {
            throw new RuntimeException('data URIs must not be fetched');
        });

        $markdown = '![inline](data:image/png;base64,AAAABBBB)';
        [$out, $warnings] = $rehoster->rehost($markdown, $this->document(), 'https://base.example.com/');

        $this->assertSame($markdown, $out);
        $this->assertSame([], $warnings);
    }

    #[Test]
    public function it_fetches_a_repeated_image_only_once(): void
    {
        Storage::fake('public');
        $calls = 0;
        $rehoster = $this->rehoster(function (string $url) use (&$calls) {
            $calls++;

            return new FetchResult(200, 'REPEAT', 'image/png', $url);
        });

        [$out] = $rehoster->rehost(
            '![a](https://cdn.example.com/x.png) then ![b](https://cdn.example.com/x.png)',
            $this->document(),
            'https://base.example.com/',
        );

        $this->assertSame(1, $calls);
        $this->assertSame(2, substr_count($out, '/storage/media/42/'));
    }
}
