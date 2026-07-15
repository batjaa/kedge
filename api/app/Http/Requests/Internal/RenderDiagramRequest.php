<?php

namespace App\Http\Requests\Internal;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates a diagram-render call (SPEC §6.2). The endpoint is internal
 * (secret-guarded by middleware), so authorization is not a Policy concern here.
 */
class RenderDiagramRequest extends FormRequest
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
            'engine' => ['required', 'string', 'max:64'],
            // Empty source is a valid (if blank) diagram; the size ceiling is
            // enforced in the renderer against the configured cap.
            'source' => ['required', 'string'],
        ];
    }
}
