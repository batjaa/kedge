<?php

namespace App\Services\Fetch;

/**
 * Why the SSRF guard refused a URL. Carried on {@see Exceptions\BlockedUrlException}
 * and emitted in the `ssrf.blocked` log event (SPEC 19) so operators can tell a
 * scheme rejection from a private-address hit from a redirect that escaped the
 * allowlist. Every case still surfaces the same user-facing message
 * ("URL not allowed (private address)") — the distinction is for logs, not users.
 */
enum BlockReason: string
{
    /** Scheme was not on the https-only allowlist (http, file, gopher, ...). */
    case DisallowedScheme = 'disallowed_scheme';

    /** URL had no parseable host. */
    case MissingHost = 'missing_host';

    /** Host resolved to (or was) a private/reserved/loopback/link-local address. */
    case PrivateAddress = 'private_address';

    /** A redirect chain exceeded the hop cap. */
    case TooManyRedirects = 'too_many_redirects';

    /** A redirect Location was missing or could not be resolved to an absolute URL. */
    case InvalidRedirect = 'invalid_redirect';
}
