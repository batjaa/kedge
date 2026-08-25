<?php

namespace App\Services\AI\Agents\Concerns;

use App\Services\AI\AiRunBudget;

/**
 * Gives an agent the HTTP timeout its job can actually afford (#153).
 *
 * laravel/ai resolves an agent's timeout in this order (`Promptable::getTimeout`):
 * the `prompt()` argument, then a `timeout()` method, then a `#[Timeout]`
 * attribute, then 60 seconds. Kedge never passes the argument and the attribute
 * takes a constant, which cannot follow config — so the method is the only seam
 * that can derive the value, and this trait is it.
 *
 * EVERY agent uses it. One agent left on the vendor default is one feature that
 * silently keeps the old 60s failure mode, which is why the guard test walks the
 * agent directory rather than a hand-written list.
 */
trait TimesOutInsideTheJobBudget
{
    public function timeout(): int
    {
        return AiRunBudget::http();
    }
}
