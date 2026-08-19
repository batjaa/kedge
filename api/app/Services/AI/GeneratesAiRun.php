<?php

namespace App\Services\AI;

use App\Models\AiRun;

/**
 * One AI run type's generator. The single queued job resolves the generator for
 * the run's type through {@see AiGeneratorRegistry} and knows nothing else about
 * what it is generating — which is what lets the four later M4 features land as
 * a generator plus an endpoint, with no change to the job, the ledger, the
 * failure split, or the polling surface.
 */
interface GeneratesAiRun
{
    public function generate(AiRun $run): AiGeneration;
}
