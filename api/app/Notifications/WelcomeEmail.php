<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

class WelcomeEmail extends VerifyEmail implements ShouldQueue
{
    use Queueable;

    public $tries = 3;

    public function __construct()
    {
        $this->afterCommit();
    }

    public function toMail($notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject('Welcome to Kedge')
            ->greeting('Welcome to Kedge, '.$notifiable->name.'!')
            ->line('Review specs with comments that keep their place.');

        if ($notifiable->hasVerifiedEmail()) {
            return $mail->action('Open Kedge', config('kedge.frontend_url'));
        }

        return $mail
            ->line('Confirm your email address to start using your account.')
            ->action('Confirm email address', $this->verificationUrl($notifiable))
            ->line('This confirmation link expires in 60 minutes.')
            ->line('If you did not create this account, you can ignore this email.');
    }
}
