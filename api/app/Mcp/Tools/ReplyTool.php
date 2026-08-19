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

#[Name(McpTool::Reply->value)]
#[Title('Reply')]
#[Description(
    'Add a comment to an existing thread. The reply inherits the thread\'s anchor — replies are never '.
    'anchored separately; to raise a point about a different passage, use post_comment with its own anchor. '.
    'The reply posts under the identity of the person who minted this token and is badged as an agent.'
)]
class ReplyTool extends Tool
{
    use ResolvesReviewSubjects;

    public function __construct(
        private readonly McpReviewWriter $writer,
    ) {}

    public function handle(Request $request): Response|ResponseFactory
    {
        $threadId = $request->get('thread_id');

        return $this->invokeTool(
            McpTool::Reply,
            $request,
            ['thread_id' => $threadId],
            function () use ($request, $threadId): ResponseFactory {
                // The REST reply endpoint's rules (StoreThreadCommentRequest).
                $validated = $request->validate([
                    'body' => ['required', 'string', 'max:20000'],
                    'idempotency_key' => ['sometimes', 'string', 'max:128'],
                ]);

                $agent = $this->agent($request);
                $thread = $this->threadFor($request, $threadId, 'reply');

                return Response::structured([
                    'comment' => $this->writer->reply(
                        $thread,
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
            'thread_id' => $schema->integer()->required()
                ->description('The thread to reply to.'),
            'body' => $schema->string()->required()->max(20000)
                ->description('The reply, in Markdown.'),
            'idempotency_key' => $schema->string()->max(128)
                ->description(
                    'Optional. Supply a stable key to make a retry of this exact call return the original '.
                    'comment instead of posting a second one. Without it, a retry posts again.'
                ),
        ];
    }
}
