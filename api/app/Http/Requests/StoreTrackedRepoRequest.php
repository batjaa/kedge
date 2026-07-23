<?php

namespace App\Http\Requests;

/**
 * Creating a tracked repo (SPEC §16, M3.6, #93). The create contract is exactly
 * preview's — a repo URL and a path pattern required, an optional branch ref and
 * project target — so it EXTENDS {@see PreviewTrackedRepoRequest} rather than
 * duplicating the rules/messages: the two can never drift. Reachability, the
 * branch-only rule (2A), the format allowlist, the file cap, and truncation are
 * the first scan's job (they need the network); a foreign project id is resolved
 * to a 404 in the controller (8A). Authorization is a Policy check there (SPEC §13).
 */
class StoreTrackedRepoRequest extends PreviewTrackedRepoRequest {}
