<?php

namespace App\Http\Requests\Auth;

use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Validator;

class RegisterRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', Password::defaults()],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $email = $this->normalizedEmail();
                $user = $email === '' ? null : User::query()->where('email', $email)->first();

                if ($user instanceof User && ! $user->isPureReviewer()) {
                    $validator->errors()->add('email', 'An account with this email already exists.');
                }
            },
        ];
    }

    public function normalizedEmail(): string
    {
        return Str::lower(trim((string) $this->input('email', '')));
    }

    /**
     * Get custom messages for validator errors.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'email.unique' => 'An account with this email already exists.',
        ];
    }
}
