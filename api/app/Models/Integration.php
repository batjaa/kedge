<?php

namespace App\Models;

use App\Enums\IntegrationProvider;
use App\Http\Resources\V1\IntegrationResource;
use App\Services\Import\Connectors\GithubPatConnector;
use Database\Factories\IntegrationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A workspace's stored credentials for a third-party source (SPEC §16, §13).
 * M1: a GitHub personal access token, used by {@see GithubPatConnector}
 * to read private (and public) GitHub files.
 *
 * Credential hygiene is the point of this model (SPEC §13):
 *   - `credentials` is an `encrypted:array` cast — the plaintext token is never
 *     stored, only its ciphertext.
 *   - `credentials` is on {@see Hidden}
 *     so it can never leak through model serialization; the API resource
 *     ({@see IntegrationResource}) is an independent
 *     allowlist that never lists it either.
 *   - the masked listing reads `meta` (a last-4 hint, a label) and never touches
 *     the ciphertext, so a normal read never decrypts the token.
 */
#[Fillable(['workspace_id', 'provider', 'credentials', 'meta'])]
#[Hidden(['credentials'])]
class Integration extends Model
{
    /** @use HasFactory<IntegrationFactory> */
    use HasFactory;

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /**
     * The stored access token. Decrypts on read — call it only where the token is
     * actually used (the connector's outbound request), never to render a response.
     */
    public function token(): string
    {
        return (string) ($this->credentials['token'] ?? '');
    }

    /**
     * The last four characters of the token, the only hint the masked listing
     * shows. Stored in `meta` at creation so listing never decrypts.
     */
    public function tokenLastFour(): ?string
    {
        $hint = $this->meta['token_last_four'] ?? null;

        return is_string($hint) && $hint !== '' ? $hint : null;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'provider' => IntegrationProvider::class,
            'credentials' => 'encrypted:array',
            'meta' => 'array',
        ];
    }
}
