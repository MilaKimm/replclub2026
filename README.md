# REPL CLUB · 현장 운영 플랫폼

2026.05.08 (FRI) — REPL CLUB 해커톤 (해시드 20층) 현장 운영용 단일 플랫폼.
LED 스크린·참가자 모바일·노트북 어디서든 같은 페이지로 접속.

**Live**: https://replclub2026.vercel.app

## 페이지

| 경로 | 용도 | 사용자 |
|------|------|--------|
| `/` | 홈 — 행사 개요 / 타임테이블 / 현장 안내 | 참가자 |
| `/board.html` | 레플 보드 — 프로젝트 등록·전시·시상 | 참가자 + 어드민 |
| `/qa.html` | 질문 보드 — 실시간 Q&A | 참가자 + 어드민 |
| `/replclubadmin2026/` | 어드민 (URL 비공개) | 운영팀 |

## 디자인 시스템

- **타이포**: Anton (display) / JetBrains Mono (label·time·code) / Pretendard (Korean body)
- **컬러**: Replit Orange `#FF3C00` · 페이퍼 `#FFFCF7` · 잉크 `#0E0E0E` · 골드 `#FFD600`
- **시그니처**: 포스터 회전 + 하드섀도우 / 손그림 SVG 언더라인 / 라이브 시계 + 카운트다운

## 데이터

현재는 **mock + localStorage** 로 구현된 정적 프로토타입.
페이지간 / 어드민 ↔ 사용자 페이지는 5초 폴링 + localStorage로 동기화.

실서비스 전환 시 백엔드 API로 교체 (Postgres + 5초 폴링 또는 WebSocket).

## 구조

```
prototype/
├─ index.html              # 홈
├─ board.html              # 레플 보드
├─ qa.html                 # 질문 보드
├─ replclubadmin2026/
│  └─ index.html           # 어드민
├─ assets/
│  └─ poster.png           # 포스터 이미지
├─ styles.css              # 공통 디자인 시스템
├─ app.js                  # 사이드바 inject · 시계 · 카운트다운
├─ data.js                 # mock 데이터 (projects, qa, attendees)
├─ robots.txt              # 어드민 URL 검색 차단
└─ README.md
```

## 어드민 진입

- URL: `/replclubadmin2026/` (메뉴 비노출)
- 또는 사용자 페이지 푸터 우하단 작은 점 클릭 → ADMIN 링크 노출
- 비밀번호 게이트 없음

## 기획 문서

- 기획안: [`현장운영플랫폼_기획안.md`](../현장운영플랫폼_기획안.md)
- 와이어프레임: [`현장운영플랫폼_와이어프레임.md`](../현장운영플랫폼_와이어프레임.md)

## 로컬 실행

```bash
npx http-server -p 8080 -c-1 .
# → http://localhost:8080/
```
