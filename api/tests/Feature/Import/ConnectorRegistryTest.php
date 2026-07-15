<?php

namespace Tests\Feature\Import;

use App\Enums\SourceType;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\Connectors\GithubPatConnector;
use App\Services\Import\Connectors\GithubPublicConnector;
use App\Services\Import\Connectors\RawUrlConnector;
use App\Services\Import\Connectors\UploadConnector;
use Tests\TestCase;

/**
 * The wired connector set (SPEC 5.1): GitHub is registered ahead of the catch-all
 * raw-URL connector, so a github.com blob URL routes to GitHub while everything
 * else — including raw.githubusercontent.com — falls through to raw. Source-type
 * resolution is what the import job uses and the only handle on the URL-less upload
 * connector.
 */
class ConnectorRegistryTest extends TestCase
{
    private function registry(): ConnectorRegistry
    {
        return app(ConnectorRegistry::class);
    }

    public function test_github_blob_urls_route_to_github_before_raw(): void
    {
        $connector = $this->registry()->match('https://github.com/octocat/Hello-World/blob/master/README.md');

        $this->assertInstanceOf(GithubPublicConnector::class, $connector);
    }

    public function test_raw_github_user_content_falls_through_to_the_raw_connector(): void
    {
        $connector = $this->registry()->match('https://raw.githubusercontent.com/octocat/Hello-World/master/README.md');

        $this->assertInstanceOf(RawUrlConnector::class, $connector);
    }

    public function test_a_plain_url_matches_the_raw_connector(): void
    {
        $connector = $this->registry()->match('https://example.com/specs/api.md');

        $this->assertInstanceOf(RawUrlConnector::class, $connector);
    }

    public function test_resolves_a_connector_by_stored_source_type(): void
    {
        $registry = $this->registry();

        $this->assertInstanceOf(GithubPublicConnector::class, $registry->forSourceType(SourceType::GithubPublic));
        $this->assertInstanceOf(GithubPatConnector::class, $registry->forSourceType(SourceType::GithubPat));
        $this->assertInstanceOf(UploadConnector::class, $registry->forSourceType(SourceType::Upload));
        $this->assertInstanceOf(RawUrlConnector::class, $registry->forSourceType(SourceType::RawUrl));
    }

    public function test_plain_match_never_returns_the_pat_connector(): void
    {
        // The PAT reader is registered after the public one, so a URL-only match of
        // a github blob URL always resolves the public reader — the authenticated
        // reader is reached only by preference (a workspace with a token).
        $this->assertInstanceOf(
            GithubPublicConnector::class,
            $this->registry()->match('https://github.com/o/r/blob/main/SPEC.md'),
        );
    }

    // --- Workspace-aware preference (#23) -----------------------------------

    public function test_preferred_match_upgrades_a_github_url_to_pat_when_the_workspace_has_a_token(): void
    {
        $connector = $this->registry()->preferredMatch(
            'https://github.com/o/r/blob/main/SPEC.md',
            hasGithubPat: true,
        );

        $this->assertInstanceOf(GithubPatConnector::class, $connector);
    }

    public function test_preferred_match_keeps_the_public_reader_when_there_is_no_token(): void
    {
        $connector = $this->registry()->preferredMatch(
            'https://github.com/o/r/blob/main/SPEC.md',
            hasGithubPat: false,
        );

        $this->assertInstanceOf(GithubPublicConnector::class, $connector);
    }

    public function test_preferred_match_never_upgrades_a_non_github_url_even_with_a_token(): void
    {
        // A raw URL is not a GitHub file; a workspace token must not hijack it.
        $connector = $this->registry()->preferredMatch(
            'https://raw.githubusercontent.com/o/r/main/README.md',
            hasGithubPat: true,
        );

        $this->assertInstanceOf(RawUrlConnector::class, $connector);
    }

    public function test_upload_is_never_matched_by_url(): void
    {
        // The upload connector is resolved only by source type — it claims no URL.
        $this->assertFalse(app(UploadConnector::class)->matches('https://example.com/anything'));
    }
}
