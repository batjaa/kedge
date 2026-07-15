<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Reap expired demo documents (SPEC 10.3, #25). Hourly is ample against a 48h
// TTL. Registered only on the SaaS: a self-hosted instance runs no demo surface,
// so it has nothing to prune (and the command no-ops there anyway).
if (! config('kedge.self_hosted')) {
    Schedule::command('kedge:prune-demo-docs')->hourly();
}
