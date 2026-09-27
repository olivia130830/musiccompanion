import { NextResponse, type NextRequest } from "next/server";

const AUTH_BACKEND_URL =
  process.env.AUTH_BACKEND_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:4000";

function unauthenticatedResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "请先登录后再使用此功能。" },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  try {
    const sessionResponse = await fetch(
      `${AUTH_BACKEND_URL}/auth-api/auth/session`,
      {
        headers: {
          cookie: request.headers.get("cookie") ?? "",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!sessionResponse.ok) {
      return unauthenticatedResponse(request);
    }
  } catch {
    return unauthenticatedResponse(request);
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    "/((?!login|auth-api|_next/static|_next/image|favicon.ico|fonts|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
