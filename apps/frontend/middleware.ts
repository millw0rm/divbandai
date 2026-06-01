import { NextResponse, type NextRequest } from 'next/server';

const TOKEN_COOKIE = 'divband_token';

export function middleware(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;
  const isProtected = pathname === '/dashboard' || pathname.startsWith('/dashboard/') || pathname.startsWith('/projects/');

  if (isProtected && !token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/projects/:path*'],
};
