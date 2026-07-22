<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Creating a tracked repo (SPEC §16, M3.6, #93). Shape validation only — the same
 * contract as preview: a repo URL and a path pattern are required, an optional
 * branch ref and an optional project target. Reachability, the branch-only rule
 * (2A), the format allowlist, the file cap, and truncation are the first scan's
 * job (they need the network); a foreign project id is resolved to a 404 in the
 * controller (8A). Authorization is a Policy check in the controller (SPEC §13),
 * not here.
 */
class StoreTrackedRepoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'repo_url' => ['required', 'string', 'max:2048'],
            'ref' => ['nullable', 'string', 'max:255'],
            'path_pattern' => ['required', 'string', 'max:1024'],
            'project_id' => ['nullable', 'integer'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'repo_url.required' => 'Paste a GitHub repository URL.',
            'path_pattern.required' => 'Enter a path pattern, like docs/**/*.md.',
        ];
    }
}
