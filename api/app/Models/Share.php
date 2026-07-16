<?php

namespace App\Models;

use App\Enums\ShareVisibility;
use Database\Factories\ShareFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A revocable, unguessable read-only link to a document (SPEC 10.2). The token
 * itself is the capability: whoever holds it reads the document and nothing else
 * (no session, no other document, no other token).
 *
 * The plaintext is shown once at creation and never persisted — only its sha256
 * digest lives in `token_hash`. Look a share up with {@see hashToken()} against
 * that column.
 */
#[Fillable([
    'document_id', 'token_hash', 'visibility', 'expires_at', 'revoked_at', 'created_by',
])]
class Share extends Model
{
    /** @use HasFactory<ShareFactory> */
    use HasFactory;

    /**
     * Mirrors the migration default so a freshly built model already carries its
     * visibility before a DB round-trip.
     *
     * @var array<string, string>
     */
    protected $attributes = [
        'visibility' => 'link',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return HasMany<ShareParticipant, $this> */
    public function participants(): HasMany
    {
        return $this->hasMany(ShareParticipant::class);
    }

    /** @return HasMany<ShareMagicLink, $this> */
    public function magicLinks(): HasMany
    {
        return $this->hasMany(ShareMagicLink::class);
    }

    /**
     * The digest stored in `token_hash` for a plaintext token. sha256 gives a
     * fixed-length key, so resolution is one indexed lookup with no timing signal
     * and the plaintext is never written anywhere.
     */
    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query
            ->whereNull('revoked_at')
            ->where(function (Builder $query): void {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            });
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /**
     * Live: not revoked, not past its expiry. The public read surface admits only
     * active shares; everything else resolves to the friendly "gone" page.
     */
    public function isActive(): bool
    {
        return ! $this->isRevoked() && ! $this->isExpired();
    }

    /**
     * Why a link is not active — `revoked` takes precedence over `expired`. Only
     * meaningful when {@see isActive()} is false; drives the "gone" response and
     * its friendly page.
     */
    public function goneReason(): ?string
    {
        if ($this->isRevoked()) {
            return 'revoked';
        }

        if ($this->isExpired()) {
            return 'expired';
        }

        return null;
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'visibility' => ShareVisibility::class,
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
