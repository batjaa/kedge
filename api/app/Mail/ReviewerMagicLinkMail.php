<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;

class ReviewerMagicLinkMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * Create a new message instance.
     */
    public function __construct(
        public readonly string $magicLinkUrl,
        public readonly string $documentTitle,
        public readonly string $inviterName,
        public readonly Carbon $expiresAt,
    ) {}

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Review link for '.$this->documentTitle,
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            view: 'mail.reviewer-magic-link',
            with: [
                'magicLinkUrl' => $this->magicLinkUrl,
                'documentTitle' => $this->documentTitle,
                'inviterName' => $this->inviterName,
                'expiresAt' => $this->expiresAt,
            ],
        );
    }

    /**
     * Get the attachments for the message.
     *
     * @return array<int, Attachment>
     */
    public function attachments(): array
    {
        return [];
    }
}
