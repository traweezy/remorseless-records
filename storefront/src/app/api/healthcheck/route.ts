import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export const GET = (_req: NextRequest) => {
  return NextResponse.json({ status: 'ok' });
};