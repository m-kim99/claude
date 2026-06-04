# Chat App

claude-sonnet-4-5-20250929 기반 개인 채팅 앱

---

## 1. Supabase 테이블 생성

Supabase 대시보드 → SQL Editor에서 실행:

```sql
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) 설정
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON messages
  FOR ALL USING (true);
```

---

## 2. 환경변수 설정

`.env.local.example`을 `.env.local`로 복사 후 값 입력:

```bash
cp .env.local.example .env.local
```

| 변수 | 설명 | 위치 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 | console.anthropic.com |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Supabase → Settings → API |
| `SYSTEM_PROMPT` | 시스템 프롬프트 (선택) | 직접 입력 |

---

## 3. 로컬 실행

```bash
npm install
npm run dev
```

→ http://localhost:3000

---

## 4. 기존 대화 시드

앱 실행 후 우측 상단 **"📥 이전 대화 불러오기"** 버튼 클릭
(1회만 실행됨, 이미 데이터가 있으면 건너뜀)

또는 직접 API 호출:
```bash
curl -X POST http://localhost:3000/api/seed
```

---

## 5. Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel

# 프로덕션 배포
vercel --prod
```

Vercel 대시보드 → Settings → Environment Variables에서
위 환경변수 동일하게 입력 후 재배포.

---

## 구조

```
app/
├── page.tsx              # 채팅 UI
└── api/
    ├── chat/route.ts     # 메시지 전송 (최근 20개 컨텍스트)
    ├── history/route.ts  # 전체 히스토리 조회
    └── seed/route.ts     # 기존 대화 시드 (1회)
lib/
└── supabase.ts           # Supabase 클라이언트
data/
└── conversation.json     # 기존 대화 데이터
```
