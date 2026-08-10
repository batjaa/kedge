<x-mail.layout :preheader="'Your one-time review link for '.$documentTitle">
    <h1 style="margin:0 0 16px 0; font-family:'Space Grotesk','Avenir Next','Segoe UI',sans-serif; font-size:18px; line-height:1.4; font-weight:600; color:#18181b;">{{ $inviterName }} invited you to review a document</h1>
    <p style="margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#52525b;">&ldquo;<strong style="color:#18181b;">{{ $documentTitle }}</strong>&rdquo; was shared with you on Kedge. Confirm this email address to open it and leave review comments.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
        <tr>
            <td style="background-color:#059669; border-radius:9999px;">
                <a href="{{ $magicLinkUrl }}" style="display:inline-block; padding:10px 24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:500; color:#ffffff; text-decoration:none;">Verify email and open review</a>
            </td>
        </tr>
    </table>
    <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#71717a;">Or paste this link into your browser:</p>
    <p style="margin:0 0 24px 0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.5; word-break:break-all;"><a href="{{ $magicLinkUrl }}" style="color:#059669; text-decoration:none;">{{ $magicLinkUrl }}</a></p>
    <hr style="margin:0 0 16px 0; border:none; border-top:1px solid #e7e5e4;">
    <p style="margin:0 0 8px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#71717a;">This link can be used once and expires {{ $expiresAt->copy()->utc()->format('M j, Y \a\t g:ia') }} UTC.</p>
    <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#71717a;">You are receiving this because this address was entered on the document&rsquo;s shared review page. If that was not you, you can ignore this email.</p>
</x-mail.layout>
