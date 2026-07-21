<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Creating a project (SPEC §16, decision 6A). The name rules are the whole
 * contract: required, ≤100 chars, and unique within the caller's own workspace —
 * the uniqueness scope is the actor's personal workspace, so it never probes
 * another workspace's names (no existence leak). Authorization is a Policy check
 * in the controller (SPEC §13), not here.
 */
class StoreProjectRequest extends FormRequest
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
        $workspaceId = $this->user()?->personalWorkspace()?->id;

        return [
            'name' => [
                'required', 'string', 'max:100',
                Rule::unique('projects', 'name')->where('workspace_id', $workspaceId),
            ],
            'description' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'Give the project a name.',
            'name.max' => 'The project name may not be longer than 100 characters.',
            'name.unique' => 'A project with that name already exists in this workspace.',
        ];
    }
}
