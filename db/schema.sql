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
