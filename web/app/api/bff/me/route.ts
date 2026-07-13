import { NextRequest, NextResponse } from 'next/server';
import { forwardMe } from '@/lib/bff';

// BFF read endpoint (SPEC §4). A same-origin request from a Client Component
// carries the httpOnly session cookie to the Next server, which forwards it to
// the API — so the client learns whether it is still signed in without ever
// reading the cookie itself. A 401 here is the signal to route to sign-in.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { session } = await forwardMe(request.headers);

  if (session) {
    return NextResponse.json({ authenticated: true, ...session });
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}
