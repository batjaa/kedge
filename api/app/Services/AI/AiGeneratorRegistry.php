<?php

namespace App\Services\AI;

use App\Enums\AiRunType;
use App\Models\AiRun;
use App\Services\AI\Exceptions\UnsupportedAiRunTypeException;
use App\Services\AI\Generators\ReviewDigestGenerator;
use Illuminate\Contracts\Container\Container;

/**
 * Maps a run type to the generator that fulfils it. M4's remaining features
 * (improve-prompt, reply draft, split, summary) each register one line here.
 *
 * A type with no generator fails the run deterministically rather than retrying
 * — an unwired type is a deploy mistake, not a blip.
 */
class AiGeneratorRegistry
{
    /** @var array<string, class-string<GeneratesAiRun>> */
    private const GENERATORS = [
        AiRunType::Digest->value => ReviewDigestGenerator::class,
    ];

    public function __construct(
        private readonly Container $container,
    ) {}

    public function for(AiRun $run): GeneratesAiRun
    {
        $generator = self::GENERATORS[$run->type->value] ?? null;

        if ($generator === null) {
            throw new UnsupportedAiRunTypeException(
                'No AI generator is registered for type ['.$run->type->value.'].',
            );
        }

        return $this->container->make($generator);
    }
}
