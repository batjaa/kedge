<?php

namespace App\Http\Resources\V1;

use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentVersionDiffResource implements Responsable
{
    public function __construct(
        private readonly Document $document,
        private readonly DocumentVersion $baseVersion,
        private readonly DocumentVersion $targetVersion,
    ) {}

    public function toResponse($request): JsonResponse
    {
        $this->document->loadCurrentVersionAndApprovals();
        $versions = [
            'a' => $this->versionPayload($this->baseVersion),
            'b' => $this->versionPayload($this->targetVersion),
        ];

        if (! $this->versionsAreComparable()) {
            return response()->json($this->payload($request, $versions, false) + [
                'message' => 'These versions cannot be compared because their projection substrates differ. Re-project them before comparing.',
            ], 409);
        }

        $versions['a']['plain_text'] = (string) $this->baseVersion->plain_text;
        $versions['b']['plain_text'] = (string) $this->targetVersion->plain_text;

        return response()->json($this->payload($request, $versions, true));
    }

    /**
     * @param  array{a: array<string, mixed>, b: array<string, mixed>}  $versions
     * @return array<string, mixed>
     */
    private function payload(Request $request, array $versions, bool $comparable): array
    {
        return [
            'comparable' => $comparable,
            'document' => [
                'id' => (int) $this->document->id,
                'title' => (string) $this->document->title,
            ],
            'current_version' => $this->currentVersionPayload(),
            'versions' => $versions,
            'approvals' => ApprovalResource::collection($this->document->activeApprovals)->resolve($request),
        ];
    }

    /**
     * @return array{id: int, ordinal: int|null, label: string, synced_at: mixed, projection_version: string|null}
     */
    private function versionPayload(DocumentVersion $version): array
    {
        $ordinal = $this->document->ordinalForVersionId((int) $version->id);

        return [
            'id' => (int) $version->id,
            'ordinal' => $ordinal,
            'label' => $this->document->versionLabelForVersionId((int) $version->id),
            'synced_at' => $version->synced_at,
            'projection_version' => $version->projection_version,
        ];
    }

    /**
     * @return array{id: int, ordinal: int|null, label: string, synced_at: mixed, projection_version: string|null}|null
     */
    private function currentVersionPayload(): ?array
    {
        $currentVersion = $this->document->currentVersion;

        return $currentVersion instanceof DocumentVersion
            ? $this->versionPayload($currentVersion)
            : null;
    }

    private function versionsAreComparable(): bool
    {
        return $this->baseVersion->plain_text !== null
            && $this->targetVersion->plain_text !== null
            && $this->baseVersion->projection_version !== null
            && $this->targetVersion->projection_version !== null
            && (string) $this->baseVersion->projection_version === (string) $this->targetVersion->projection_version;
    }
}
