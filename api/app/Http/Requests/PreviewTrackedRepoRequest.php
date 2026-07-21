<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Previewing a tracked repo (SPEC §16, M3.6). Shape validation only — a repo URL
 * and a path pattern are required, an optional branch ref and project target.
 * Reachability, the branch-only rule (2A), the format allowlist, the file cap,
 * and overlap all live in the preview service (they need the network). Deeper
 * ref semantics aren't validated here: a tag/SHA looks like any string, so the
 * branch check is a live GitHub call, not a regex. Authorization is a Policy
 * check in the controller (SPEC §13), not here.
 */
class PreviewTrackedRepoRequest extends FormRequest
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
