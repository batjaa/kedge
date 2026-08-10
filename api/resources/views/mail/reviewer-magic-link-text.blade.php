{{-- Plain-text part: raw output ({!! !!}) is correct here — Blade's {{ }}
     HTML-entity escaping would corrupt this non-HTML body (an & in the signed
     URL's query string became &amp;, breaking a pasted link). --}}
{!! $inviterName !!} invited you to review "{!! $documentTitle !!}" on Kedge.

Confirm this email address to open the document and leave review comments:

{!! $magicLinkUrl !!}

This link can be used once and expires {{ $expiresAt->copy()->utc()->format('M j, Y \a\t g:ia') }} UTC.

You are receiving this because this address was entered on the document's shared review page. If that was not you, you can ignore this email.

Kedge - Comments that keep their place
