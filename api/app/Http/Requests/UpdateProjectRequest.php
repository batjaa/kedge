<?php

namespace App\Http\Requests;

use App\Models\Project;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Renaming a project or editing its description (SPEC §16, decision 6A). Partial
 * by design — a caller may send just the name, just the description, or both.
 * When a name is sent it obeys the same rules as create, uniqueness scoped to
 * this project's workspace and ignoring this project itself (a no-op rename must
 * not collide with its own row). Authorization is the controller's Policy check.
 */
class UpdateProjectRequest extends FormRequest
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
        /** @var Project $project */
        $project = $this->route('project');

        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:100',
                Rule::unique('projects', 'name')
                    ->where('workspace_id', $project->workspace_id)
                    ->ignore($project->id),
            ],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
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
