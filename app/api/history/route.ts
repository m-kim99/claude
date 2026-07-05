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
      .select('id, role, content, images, created_at')
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (before) {
      query = query.lt('id', parseInt(before));
    }

    const result = await query;
    let data: { id: number; role: string; content: string; images?: unknown; created_at: string }[] | null =
      result.data;
    let error = result.error;

    // images 컬럼이 아직 없는 DB(미마이그레이션) 폴백
    if (error && /images/i.test(error.message)) {
      let fallback = supabase
        .from('messages')
        .select('id, role, content, created_at')
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (before) {
        fallback = fallback.lt('id', parseInt(before));
      }
      const fallbackResult = await fallback;
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

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
