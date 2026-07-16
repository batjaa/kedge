<p>{{ $inviterName }} shared "{{ $documentTitle }}" with you in Kedge and invited you to review it.</p>

<p>You received this email because someone entered this address on that document's shared review page.</p>

<p><a href="{{ $magicLinkUrl }}">Verify email to review</a></p>

<p>This link expires at {{ $expiresAt->toIso8601String() }} and can be used once.</p>
