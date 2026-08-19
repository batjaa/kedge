<?php

namespace App\Http\Requests;

use App\Enums\ReplyStance;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreReplyDraftRequest extends FormRequest
{
    /**
     * Authorization is the controller's Policy call, as everywhere else in v1.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The stance is REQUIRED and closed to the enum: there is no "let the model
     * decide" stance, because choosing the position is the author's act, not the
     * AI's (SPEC §14, user story 5).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'stance' => ['required', Rule::enum(ReplyStance::class)],
        ];
    }

    public function stance(): ReplyStance
    {
        return ReplyStance::from((string) $this->validated('stance'));
    }
}
