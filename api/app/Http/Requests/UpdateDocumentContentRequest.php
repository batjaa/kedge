<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\CapsPastedContent;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates a manual content update for a pasted/uploaded document (#113): the
 * author re-pastes the body to mint a new version through the same pipeline a
 * re-sync uses. Authorization is a Policy check in the controller (SPEC §13), not
 * here — this only shapes the input, and it mirrors the paste side of
 * {@see StoreDocumentRequest}: `content` is required and byte-capped (the same
 * {@see CapsPastedContent} rule, so the update surface can never accept a larger
 * body than the original paste), with an optional replacement title.
 */
class UpdateDocumentContentRequest extends FormRequest
{
    use CapsPastedContent;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'content' => ['required', 'string', $this->withinPasteCap()],
            'title' => ['nullable', 'string', 'max:255'],
        ];
    }
}
