{{-- Shared branded email frame (Open Harbor, light register only: email clients
     handle dark-mode inversion themselves and the light card survives it best).
     Tokens mirror docs/DESIGN.md: stone-50 ground, white card on a stone-200
     hairline, zinc text, emerald-600 the sole accent. Table layout + inline
     styles for client compatibility; no webfonts are fetched, the display
     stack falls back to system faces. Future mailables (M5 notifications,
     digests) should wrap their body in this component. --}}
@props(['preheader' => null])
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0; padding:0; background-color:#fafaf9; -webkit-text-size-adjust:100%;">
@if ($preheader)
    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">{{ $preheader }}</div>
@endif
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafaf9;">
    <tr>
        <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
                <tr>
                    <td style="padding:0 8px 16px 8px;">
                        <span style="font-family:'Space Grotesk','Avenir Next','Segoe UI',sans-serif; font-size:20px; font-weight:600; letter-spacing:-0.02em; color:#18181b;">Kedge<span style="color:#059669;">.</span></span>
                    </td>
                </tr>
                <tr>
                    <td style="background-color:#ffffff; border:1px solid #e7e5e4; border-radius:16px; padding:32px;">
                        {{ $slot }}
                    </td>
                </tr>
                <tr>
                    <td style="padding:16px 8px 0 8px;">
                        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#a1a1aa;">Kedge &middot; Comments that keep their place</p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
