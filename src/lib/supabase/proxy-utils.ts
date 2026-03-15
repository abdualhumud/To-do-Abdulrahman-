import { NextResponse, type NextRequest } from "next/server";

// No-op middleware: auth is handled client-side via localStorage.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function updateSession(_request: NextRequest) {
  return NextResponse.next();
}
