-- 인터뷰 저장과 이어가기의 표 두 개입니다. 설계 근거는 노션 기능 정의서 `인터뷰 저장과 이어가기`와
-- `llm-wiki/wiki/2026-09-14-Neon-접속계층과-세션-사용자번호.md`에 있습니다.
--
-- 정의서 SQL과 다른 점이 하나 있습니다. 정의서의 `create index on ...`에는 인덱스 이름이 없어서
-- Postgres가 이름을 자동으로 붙이고 `if not exists`를 쓸 수 없습니다. 이 파일은 여러 번 돌려도
-- 같은 결과가 나와야 하므로 인덱스에 이름을 붙였습니다.

create table if not exists repository_analysis (
  id                 uuid primary key,
  github_user_id     bigint      not null,
  repo_owner         text        not null,
  repo_name          text        not null,
  contribution_items jsonb       not null,
  candidates         jsonb       not null,
  stage_a_summary    jsonb       not null,
  created_at         timestamptz not null default now()
);

create table if not exists interview_session (
  id            uuid        primary key,
  analysis_id   uuid        not null references repository_analysis(id) on delete cascade,
  candidate_key text        not null,
  title         text        not null,
  evidence      jsonb       not null,
  history       jsonb       not null,
  block_state   jsonb       not null,
  block_version integer     not null,
  status        text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  opened_at     timestamptz not null default now()
);

create index if not exists repository_analysis_user_created_idx
  on repository_analysis (github_user_id, created_at desc);

create index if not exists interview_session_analysis_idx
  on interview_session (analysis_id);

-- 질문 진행 상태입니다(이슈 #115). 정의서의 SQL에는 없던 칸이고 2026-09-14에 더했습니다.
--
-- 블록의 요소마다 몇 번 물었는지와 언제 처음 "기억나지 않는다"를 받았는지를 담습니다. 그 값이
-- 재질문 예산을 정하므로, 저장하지 않으면 복원한 인터뷰가 사용자가 이미 답하지 못한 요소를 예산만큼
-- 다시 묻습니다. 블록 상태의 평가로는 이 값을 대신할 수 없습니다.
--
-- 이미 만들어진 표에도 돌아야 하므로 `add column if not exists`를 씁니다. 칸을 더하는 문장이라
-- 되돌릴 수 없는 변경이 아니고, 여러 번 돌려도 결과가 같습니다.
alter table interview_session
  add column if not exists progress jsonb not null default '{}'::jsonb;
