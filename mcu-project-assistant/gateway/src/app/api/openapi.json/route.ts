import { NextResponse } from 'next/server'

export async function GET() {
  const spec = require('@/lib/openapi').default
  return NextResponse.json(spec)
}
