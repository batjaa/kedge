<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Share links (SPEC 10.2, 16). An author hands a doc to people with no account
 * via an unguessable, revocable token with optional expiry.
 *
 * The plaintext token is shown exactly once, at creation, and never stored: the
 * row keeps only `sha256(token)`. Resolution is a single indexed lookup on that
 * fixed-length hash — never a scan comparing plaintext tokens — so lookup leaks
 * no timing signal and a database leak yields no working links.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();

            // sha256 hex digest (64 chars) of the one-time plaintext token. Unique
            // + indexed: resolution is a constant-shape lookup by hash, and the
            // plaintext never touches the database.
            $table->string('token_hash', 64)->unique();

            // `link` only at M1 (SPEC 10.2). `email_restricted` / `workspace` are
            // additive once M2 identity exists — the column already holds them.
            $table->string('visibility')->default('link');

            // Optional expiry and revocation. Both nullable and null by default:
            // an active link is one that is neither past `expires_at` nor revoked.
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // Listing a document's shares is a common owner action.
            $table->index('document_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shares');
    }
};
