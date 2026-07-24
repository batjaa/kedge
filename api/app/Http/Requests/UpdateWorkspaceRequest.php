<?php

namespace App\Http\Requests;

use App\Models\Workspace;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Renaming a workspace / editing its slug from Settings → General (SPEC §16, M3.7
 * decision 11A). Partial by design — a caller may send just the name, just the
 * slug, or both. Authorization is the controller's Policy check (owner-only), not
 * here.
 *
 * The slug is a stable URL handle: lowercase word groups joined by single hyphens,
 * globally unique (the workspaces table carries a single-column unique index) and
 * ignoring this workspace's own row so a no-op save never collides with itself. A
 * clash is rejected inline with a friendly 422, mirroring the project name rules.
 */
class UpdateWorkspaceRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'slug' => [
                'sometimes', 'required', 'string', 'max:60',
                'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/',
                Rule::unique(Workspace::class, 'slug')->ignore($workspaceId),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'Give your workspace a name.',
            'name.max' => 'The workspace name may not be longer than 100 characters.',
            'slug.required' => 'Give your workspace a slug.',
            'slug.max' => 'The slug may not be longer than 60 characters.',
            'slug.regex' => 'The slug may use only lowercase letters, numbers, and single hyphens.',
            'slug.unique' => 'That slug is already taken. Choose another.',
        ];
    }
}
