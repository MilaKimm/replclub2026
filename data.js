// REPL CLUB — Mock data (정적 데모용)
// 실서비스 전환 시 백엔드 API로 교체 예정.

window.RC_DATA = {
  config: {
    eventDate: '2026.05.08 (FRI)',
    venue: '해시드 20층',
    deadline: '21:45',
    sosPhone: '010-0000-0000',
    wifi: { ssid: 'HASHED-GUEST', pw: 'replclub2026' },
    awards: { gold: 1, silver: 1, bronze: 1, special: 6, passed: 5 },
    toiletLocation: '입구 LED 옆',
  },

  timetable: [
    { time: '18:30', label: '체크인 + 간단한 저녁 제공', link: null },
    { time: '19:10', label: '오프닝', link: null },
    { time: '19:15', label: 'Replit 본사 Keynote', link: 'https://replit-douzone-hackathon.replit.app/' },
    { time: '19:25', label: '행사 진행 안내', link: null },
    { time: '19:45', label: '빌드 타임 시작', link: null, isNow: true },
    { time: '21:45', label: '제출 마감', link: null },
    { time: '22:00', label: '상위 팀 발표', link: null },
    { time: '22:35', label: '시상식', link: null },
  ],

  replitGuide: [
    {
      title: '레플릿 회원 가입',
      desc: 'replit.com 에서 회원가입을 해주세요.\n홈 화면 우측 상단의 "Create Account" 버튼을 누르고, 이메일 또는 Google 계정으로 가입할 수 있습니다.',
      link: 'https://replit.com/',
      linkLabel: 'replit.com 바로가기 →',
    },
    {
      title: '크레딧 신청',
      desc: '레플클럽 구글폼에 본인 Replit 계정을 제출해주세요.\n행사 당일 본인 계정에 $100 상당의 Pro 구독이 지급됩니다.\n※ Luma 참가 승인 대상자에 한해 1인 1회 지급됩니다.\n※ 지급 여부 확인 방법: 로그인 > Settings > Billing > Current plan',
      link: 'https://forms.gle/uhAnQvrqn18ZSqRq9',
      linkLabel: '구글폼 제출하기 →',
    },
    {
      title: '빌드 시작!',
      desc: '크레딧 지급이 확인되면 곧바로 프로젝트를 만들어보세요.\n대화창에서 만들고 싶은 아이디어를 설명하기만 하면, Replit이 코드·DB·배포까지 알아서 해줍니다.',
      link: null,
      linkLabel: null,
    },
    {
      title: '프로젝트 등록',
      desc: '좌측 사이드바 \'레플 보드\' 메뉴에서 본인 프로젝트를 등록해주세요.\n1인 또는 2인 팀으로 참가 가능하며, 레플 보드를 통해 1차 심사가 진행됩니다.',
      link: 'https://replclub2026.vercel.app/board.html',
      linkLabel: '레플 보드 →',
    },
    {
      title: '막힐 때 도움 받기',
      desc: '궁금한 점이 생기면 좌측 사이드바 \'질문 보드\'에 남겨주세요.\nREPL CLUB 운영팀이 단계별로 답변해드립니다.',
      link: 'https://replclub2026.vercel.app/qa.html',
      linkLabel: '질문 보드 →',
    },
  ],

  judging: {
    judges: [
      { name: 'Replit 본사', role: '글로벌 1위 바이브 코딩 플랫폼' },
      { name: 'Hashed', role: '한국 대표 블록체인·Web3 VC' },
      { name: '마켓핏랩', role: 'Replit 한국 공식 파트너' },
    ],
    process: [
      {
        title: '1차 심사',
        items: [
          '빌드 시작 약 1시간 경, 심사위원이 각 팀의 프로젝트를 검토하여 기획 내용과 구현 완성도를 확인',
          '2차 발표 심사 진출할 5팀 선정',
          '프로젝트 등록 시 "5문답"을 또렷하게 작성하시는 게 유리해요.',
        ],
      },
      {
        title: '2차 심사',
        items: [
          '1차 심사에서 선발된 5팀 발표 (3분 발표 + 1분 질의)',
          '최종 1~3위 (각 1팀), 특별상 (6팀) 선정',
          '발표 시간이 짧기 때문에 "누가 왜 쓰는가 + 오늘 진짜 동작하는 부분"을 보여주는 게 핵심이에요.',
        ],
      },
    ],
    criteria: [
      { name: '비즈니스 임팩트', weight: 40 },
      { name: '완성도', weight: 30 },
      { name: '창의성', weight: 20 },
      { name: '발표력', weight: 10 },
    ],
  },

  // 시상 단계 공개 상태 (어드민 단계별 공개 시뮬레이션)
  // 'hidden' | 'passed' | 'bronze' | 'silver' | 'gold'
  awardPhase: 'hidden',

  // 빈 상태 — Replit DB 연동 후 실제 등록·CSV 업로드로 채워짐
  projects: [],
  qa: [],
  attendees: [],
};
