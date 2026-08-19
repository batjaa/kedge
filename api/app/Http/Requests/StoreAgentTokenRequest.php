<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Minting an **Agent Token** (SPEC §15, #131). The name is the whole payload:
 * an operator running three agents needs to know which one to cut off, so a
 * token without a recognizable name is useless the moment it matters.
 *
 * Authorization is a Policy check in the controller (SPEC §13), not here. The
 * workspace scope is NOT client-supplied — the controller derives it from the
 * caller's own workspace, so a request body can never widen a token's reach.
 */
class StoreAgentTokenRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:80'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'Give the agent token a name so you can tell it apart later.',
            'name.max' => 'The token name may not be longer than 80 characters.',
        ];
    }

    /**
     * The submitted name, trimmed of paste whitespace.
     */
    public function tokenName(): string
    {
        return trim((string) $this->validated('name'));
    }
}
