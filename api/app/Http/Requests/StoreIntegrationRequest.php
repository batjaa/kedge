<?php

namespace App\Http\Requests;

use App\Enums\IntegrationProvider;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Connecting an integration (SPEC §16). M1 accepts a single provider,
 * `github_pat`; it is the default and the only allowed value, so an omitted or
 * mismatched provider is handled here rather than deeper in.
 *
 * `token` is the secret itself. It is validated only for shape (present,
 * plausible length) — never echoed back, never logged. The GitHub PAT formats
 * (`ghp_…`, `github_pat_…`, or a legacy 40-hex) all comfortably clear the floor.
 */
class StoreIntegrationRequest extends FormRequest
{
    /**
     * Authorization is handled by the controller via IntegrationPolicy.
     */
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
            'provider' => ['sometimes', Rule::enum(IntegrationProvider::class)],
            'token' => ['required', 'string', 'min:8', 'max:500'],
        ];
    }

    /**
     * The provider to connect — `github_pat` unless a (valid) one is given.
     */
    public function provider(): IntegrationProvider
    {
        $value = $this->input('provider');

        return $value !== null
            ? IntegrationProvider::from((string) $value)
            : IntegrationProvider::GithubPat;
    }

    /**
     * The submitted token, trimmed of stray whitespace (a paste artifact).
     */
    public function token(): string
    {
        return trim((string) $this->validated('token'));
    }
}
