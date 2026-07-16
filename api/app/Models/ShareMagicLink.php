<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['share_id', 'email', 'token_hash', 'expires_at', 'used_at'])]
class ShareMagicLink extends Model
{
    public function share(): BelongsTo
    {
        return $this->belongsTo(Share::class);
    }

    /** @return HasMany<ShareMagicLinkCompletion, $this> */
    public function completions(): HasMany
    {
        return $this->hasMany(ShareMagicLinkCompletion::class);
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isUsed(): bool
    {
        return $this->used_at !== null;
    }

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }
}
