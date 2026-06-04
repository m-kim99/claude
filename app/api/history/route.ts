import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const before = searchParams.get('before');

    let query = supabase
      .from('messages')
      .select('id, role, content, created_at')
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (before) {
      query = query.lt('id', parseInt(before));
    }

    const { data, error } = await query;
    if (error) throw error;

    const hasMore = (data || []).length > limit;
    const messages = (data || []).slice(0, limit).reverse();

    return NextResponse.json(
      { messages, hasMore },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
