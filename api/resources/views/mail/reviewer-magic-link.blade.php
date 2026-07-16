<p>Use this link to verify your email and comment on "{{ $documentTitle }}".</p>

<p><a href="{{ $magicLinkUrl }}">Verify email to review</a></p>

<p>This link expires at {{ $expiresAt->toIso8601String() }} and can be used once.</p>
