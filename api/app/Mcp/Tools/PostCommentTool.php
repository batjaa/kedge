<?php

namespace App\Mcp\Tools;

use App\Enums\McpTool;
use App\Mcp\Concerns\ResolvesReviewSubjects;
use App\Services\Agents\McpReviewWriter;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Title;
use Laravel\Mcp\Server\Tool;

#[Name(McpTool::PostComment->value)]
#[Title('Post comment')]
#[Description(
    'Start a new review thread on a document. With an `anchor`, the thread is attached to that exact text; '.
    'without one, it hangs off the document as a whole. '.
    'To anchor: read the document, take `version.plain_text`, and give `exact` plus the UTF-16 code-unit '.
    '`start`/`end` offsets of that substring within it, along with the `projection_version` you read. '.
    'The server re-checks that `exact` really sits at those offsets and rejects the comment if the document '.
    'has moved on — re-read and retry rather than guessing. '.
    'The comment posts under the identity of the person who minted this token and is badged as an agent; '.
    'it is never disguised as human.'
)]
class PostCommentTool extends Tool
{
    use ResolvesReviewSubjects;

    public function __construct(
        private readonly McpReviewWriter $writer,
    ) {}

    public function handle(Request $request): Response|ResponseFactory
    {
        $documentId = $request->get('document_id');

        return $this->invokeTool(
            McpTool::PostComment,
            $request,
            ['document_id' => $documentId],
            function () use ($request, $documentId): ResponseFactory {
                // The REST capture path's rules, verbatim (StoreThreadRequest):
                // the anchor crosses the same trust boundary whether a browser or
                // an agent captured it, so it is bounded the same way before the
                // service re-validates it against the live projection.
                $validated = $request->validate([
                    'body' => ['required', 'string', 'max:20000'],
                    'idempotency_key' => ['sometimes', 'string', 'max:128'],
                    'anchor' => ['nullable', 'array'],
                    'anchor.exact' => ['required_with:anchor', 'string', 'max:20000'],
                    'anchor.prefix' => ['nullable', 'string', 'max:1000'],
                    'anchor.suffix' => ['nullable', 'string', 'max:1000'],
                    'anchor.start' => ['required_with:anchor', 'integer', 'min:0'],
                    'anchor.end' => ['required_with:anchor', 'integer', 'min:1'],
                    'anchor.heading_path' => ['sometimes', 'array'],
                    'anchor.heading_path.*' => ['string', 'max:255'],
                    'anchor.projection_version' => ['required_with:anchor', 'string', 'max:64'],
                ]);

                $agent = $this->agent($request);
                $document = $this->documentForThreadAbility($request, $documentId, 'create');

                return Response::structured([
                    'thread' => $this->writer->postComment(
                        $document,
                        $agent,
                        $validated,
                        request()->ip(),
                    ),
                ]);
            },
        );
    }

    /**
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'document_id' => $schema->integer()->required()
                ->description('The document to comment on.'),
            'body' => $schema->string()->required()->max(20000)
                ->description('The comment, in Markdown.'),
            'anchor' => $schema->object([
                'exact' => $schema->string()->required()->max(20000)
                    ->description('The exact selected text, copied from version.plain_text.'),
                'start' => $schema->integer()->required()->min(0)
                    ->description('UTF-16 code-unit offset of the selection start within version.plain_text.'),
                'end' => $schema->integer()->required()->min(1)
                    ->description('UTF-16 code-unit offset of the selection end (exclusive).'),
                'projection_version' => $schema->string()->required()->max(64)
                    ->description('The version.projection_version the offsets were computed against.'),
                'prefix' => $schema->string()->max(1000)->description('Text immediately before the selection.'),
                'suffix' => $schema->string()->max(1000)->description('Text immediately after the selection.'),
                'heading_path' => $schema->array()->description('Enclosing headings, outermost first.'),
            ])->description('Anchor the thread to a passage. Omit for a document-level thread.'),
            'idempotency_key' => $schema->string()->max(128)
                ->description(
                    'Optional. Supply a stable key to make a retry of this exact call return the original '.
                    'thread instead of posting a second one. Without it, a retry posts again.'
                ),
        ];
    }
}
