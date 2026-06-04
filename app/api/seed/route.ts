import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    success: false,
    message: '시드 데이터는 이미 Supabase에 존재합니다.',
  });
}
