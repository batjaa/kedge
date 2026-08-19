<?php

namespace App\Services\Agents;

use App\Enums\AiRunType;
use App\Models\Document;
use App\Services\AI\AiArtifactStaleness;
use App\Services\AI\AiRunLedger;

/**
 * The read behind `get_digest` and `get_improve_prompt` (SPEC §15, #136) — the
 * agent-side counterpart to {@see McpReviewWriter}, and the reason those two
 * tools stay the thin adapters the spec asks for.
 *
 * **This service cannot generate anything, and that is the point.** MCP never
 * mints a run: generation spends the workspace's Anthropic key, so it stays a
 * human act in the app where a person chose it, and an agent that could trigger
 * one could burn the key in a loop. So there is no ledger `startOrJoin` here, no
 * job dispatch, no fallback that "just generates one if none exists" — the only
 * ledger call in this file is a read.
 *
 * Three honest-emptiness rules follow from that:
 *
 *  1. **Nothing generated yet → an empty result, not an error.** An agent asking
 *     a reasonable question about a document with no digest gets a plain "none
 *     exists, and here is who can make one".
 *  2. **AI not configured → the same empty result.** MCP is gated independently
 *     of the AI flag: a keyless self-host hosts agent reviewers all the same, and
 *     these two tools report the absence rather than failing the call. When the
 *     key is gone the whole AI surface is gone (its REST routes 404, the web
 *     hides the panels); MCP must not become the one back door still serving
 *     artifacts the rest of the product has withdrawn.
 *  3. **Only a COMPLETED run is ever served.** A pending, running, or failed run
 *     is not an artifact — serving one would hand an agent an empty output it
 *     would read as "the review said nothing".
 */
class McpArtifactReader
{
    public function __construct(
        private readonly AiRunLedger $ledger,
        private readonly AiArtifactStaleness $staleness,
        private readonly McpPayload $payload,
    ) {}

    /**
     * The latest completed artifact of this type for the document, with its
     * staleness metadata — or an honest empty envelope.
     *
     * The envelope's shape is the SAME either way (`artifact` is simply null), so
     * an agent parses one response format and reads `note` for the reason.
     *
     * @return array<string, mixed>
     */
    public function read(Document $document, AiRunType $type): array
    {
        if (! (bool) config('kedge.ai.enabled', false)) {
            return $this->empty(
                $document,
                $type,
                aiEnabled: false,
                note: sprintf(
                    'This Kedge instance has no AI provider configured, so no %s exists to read. '
                    .'The rest of the review — documents, threads, comments — is unaffected.',
                    $this->noun($type),
                ),
            );
        }

        $run = $this->ledger->latestCompletedFor($document, $type);

        if ($run === null) {
            return $this->empty(
                $document,
                $type,
                aiEnabled: true,
                note: sprintf(
                    'No %s has been generated for this document yet. Generating one is a person\'s decision in '
                    .'the Kedge app — this tool only reads what already exists, and no MCP tool can start a run.',
                    $this->noun($type),
                ),
            );
        }

        $staleness = $this->staleness->for($run, $document);

        return $this->envelope(
            $document,
            $type,
            aiEnabled: true,
            artifact: $this->payload->artifact($run, $staleness),
            // Null when the artifact is current: an agent should read a warning
            // here or nothing, never a reassurance it might skim past.
            note: $staleness->statement(),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function empty(Document $document, AiRunType $type, bool $aiEnabled, string $note): array
    {
        return $this->envelope($document, $type, $aiEnabled, artifact: null, note: $note);
    }

    /**
     * @param  array<string, mixed>|null  $artifact
     * @return array<string, mixed>
     */
    private function envelope(
        Document $document,
        AiRunType $type,
        bool $aiEnabled,
        ?array $artifact,
        ?string $note,
    ): array {
        return [
            'document_id' => (int) $document->id,
            'type' => $type->value,
            // Whether this instance can produce artifacts at all — so an agent
            // can tell "nobody has asked for one" from "this deployment has no
            // model to ask", which are different things to report to an operator.
            'ai_enabled' => $aiEnabled,
            'artifact' => $artifact,
            'note' => $note,
        ];
    }

    /**
     * What this artifact is called in a sentence an agent may repeat to a human.
     */
    private function noun(AiRunType $type): string
    {
        return match ($type) {
            AiRunType::ImprovePrompt => 'improve-the-doc prompt',
            AiRunType::Digest => 'review digest',
            default => 'artifact',
        };
    }
}
