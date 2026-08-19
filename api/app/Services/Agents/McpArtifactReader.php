<?php

namespace App\Services\Agents;

use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Models\AiRun;
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
 *     would read as "the review said nothing". It is still REPORTED, in
 *     `latest_run_status` and in the note: "a generation is running" and "nobody
 *     has asked for one" are different answers, and only one of them means an
 *     agent should go and ask a human.
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

        // The newest run of any status, then — only if it is not the answer — the
        // newest completed one. The common case (nothing newer since the last
        // successful generation) costs a single query, and the run's status is in
        // hand either way, so the empty result can say WHY it is empty.
        $latest = $this->ledger->latestFor($document, $type);

        $run = $latest?->status === AiRunStatus::Completed
            ? $latest
            : $this->ledger->latestCompletedFor($document, $type);

        if ($run === null) {
            return $this->empty($document, $type, aiEnabled: true, latest: $latest, note: $this->emptyNote($type, $latest));
        }

        $staleness = $this->staleness->for($run, $document);

        return $this->envelope(
            $document,
            $type,
            aiEnabled: true,
            latest: $latest,
            artifact: $this->payload->artifact($run, $staleness),
            // Null when the artifact is current: an agent should read a warning
            // here or nothing, never a reassurance it might skim past.
            note: $staleness->statement(),
        );
    }

    /**
     * Why there is nothing to read — three different situations that a single
     * "none has been generated" would flatten into a half-truth, telling an agent
     * to go ask a human while a run that human already started is mid-flight.
     */
    private function emptyNote(AiRunType $type, ?AiRun $latest): string
    {
        $noun = $this->noun($type);

        if ($latest === null) {
            return sprintf(
                'No %s has been generated for this document yet. Generating one is a person\'s decision in '
                .'the Kedge app — this tool only reads what already exists, and no MCP tool can start a run.',
                $noun,
            );
        }

        if ($latest->status->isInFlight()) {
            return sprintf(
                'A %s is being generated right now and has not finished, and no earlier one ever completed. '
                .'Nothing is ready to read; try again shortly. This tool cannot start or hurry a run.',
                $noun,
            );
        }

        return sprintf(
            'The most recent %s generation failed, and no earlier one completed. A person can retry it in the '
            .'Kedge app — this tool only reads what already exists, and no MCP tool can start a run.',
            $noun,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function empty(
        Document $document,
        AiRunType $type,
        bool $aiEnabled,
        string $note,
        ?AiRun $latest = null,
    ): array {
        return $this->envelope($document, $type, $aiEnabled, $latest, artifact: null, note: $note);
    }

    /**
     * @param  array<string, mixed>|null  $artifact
     * @return array<string, mixed>
     */
    private function envelope(
        Document $document,
        AiRunType $type,
        bool $aiEnabled,
        ?AiRun $latest,
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
            // The newest run of this type, whatever became of it. Not the same
            // question as `artifact`: `completed` here with a stale artifact
            // means nothing newer was asked for, while `running` alongside a
            // served artifact means a fresher answer is on its way.
            'latest_run_status' => $latest?->status->value,
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
