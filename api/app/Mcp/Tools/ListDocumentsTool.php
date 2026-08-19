<?php

namespace App\Mcp\Tools;

use App\Enums\McpTool;
use App\Mcp\Concerns\ResolvesReviewSubjects;
use App\Models\Document;
use App\Services\Agents\Exceptions\McpToolException;
use App\Services\Agents\McpPayload;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Illuminate\Support\Facades\Gate;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Title;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name(McpTool::ListDocuments->value)]
#[Title('List documents')]
#[Description(
    'List the documents in the workspace this agent token is scoped to, newest first. '.
    'Paginated: pass `page` and `per_page` (max 50) and read `pagination.has_more` — a short page is not the end. '.
    'Returns identity and review state only; call `get_document` for a document\'s content.'
)]
#[IsReadOnly]
class ListDocumentsTool extends Tool
{
    use ResolvesReviewSubjects;

    public function __construct(
        private readonly McpPayload $payload,
    ) {}

    public function handle(Request $request): Response|ResponseFactory
    {
        return $this->invokeTool(McpTool::ListDocuments, $request, [], function () use ($request): ResponseFactory {
            $agent = $this->agent($request);

            // The same Policy the REST list resolves: personal-workspace holders
            // only, and — through the shared membership trait — only a token that
            // names that workspace.
            if (Gate::denies('viewAny', Document::class)) {
                throw new McpToolException('This agent token cannot list documents in any workspace.');
            }

            [$page, $perPage] = $this->pageArguments($request);

            // Scoped exactly as GET /api/v1/documents scopes: the caller's own
            // workspace, so an id is never an access path and the reserved system
            // workspace's demo documents fall outside structurally.
            $documents = $agent->personalWorkspace()->documents()
                ->latest()
                ->orderByDesc('id')
                ->paginate($perPage, ['*'], 'page', $page);

            return Response::structured([
                'documents' => $documents->getCollection()
                    ->map(fn (Document $document): array => $this->payload->documentSummary($document))
                    ->values()
                    ->all(),
                'pagination' => $this->payload->pagination($documents),
            ]);
        });
    }

    /**
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'page' => $schema->integer()->min(1)->description('1-based page number. Defaults to 1.'),
            'per_page' => $schema->integer()->min(1)->max(50)
                ->description('Documents per page, 1-50. Defaults to 20.'),
        ];
    }
}
