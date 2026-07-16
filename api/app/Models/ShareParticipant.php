<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['share_id', 'user_id', 'verified_at'])]
class ShareParticipant extends Model
{
    public function share(): BelongsTo
    {
        return $this->belongsTo(Share::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @param  Builder<ShareParticipant>  $query
     * @return Builder<ShareParticipant>
     */
    public function scopeVerifiedForActiveDocumentShare(Builder $query, Document $document): Builder
    {
        return $query
            ->whereNotNull('verified_at')
            ->whereHas('share', function (Builder $query) use ($document): void {
                $query->where('document_id', $document->id)
                    ->active();
            });
    }

    protected function casts(): array
    {
        return [
            'verified_at' => 'datetime',
        ];
    }
}
