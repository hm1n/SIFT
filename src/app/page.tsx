import { SiteFooter } from "@/components/shell/site-footer";
import { AnalyticsSession, type LoginResult } from "@/features/analytics/analytics-session";
import { toAuthErrorParam } from "@/features/auth/auth-error";
import { LoginScreen } from "@/features/auth/login-screen";
import { RepositoryFlow } from "@/features/repository-selection/repository-flow";
import { toAnalyticsUserId } from "@/lib/analytics/user-id";
import { GITHUB_SESSION_COOKIE, decryptGitHubSession } from "@/lib/github/auth-session";
import { cookies } from "next/headers";

interface HomeSearchParams {
  auth_error?: string | string[];
  login?: string | string[];
  /** 회원 탈퇴를 끝낸 계정 메뉴가 붙여 보내는 표시입니다(이슈 #145). */
  withdrawn?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 세션 쿠키에서 GA4 `user_id`를 만듭니다. 실패하면 null이고 화면은 그대로 그립니다.
 *
 * 복호화를 try/catch로 감싸는 이유입니다. `decryptGitHubSession`은 만료된 쿠키, 옛 형식의 쿠키,
 * 암호화 키가 없는 서버에서 모두 예외를 던집니다. 이 페이지는 지금까지 쿠키의 존재만 보고 화면을
 * 갈랐고, 만료된 쿠키를 든 사용자는 화면을 받은 뒤 API 호출에서 재로그인 안내를 받습니다. 계측
 * 하나 때문에 그 경로가 서버 오류로 바뀌면 안 됩니다.
 */
function analyticsUserIdFrom(sessionCookie: string): string | null {
  try {
    return toAnalyticsUserId(decryptGitHubSession(sessionCookie).githubUserId);
  } catch {
    return null;
  }
}

/**
 * 계측을 마친 뒤 남길 주소입니다. 일회성 표시(`login`)만 빠지고 오류 안내용 `auth_error`는 남습니다.
 *
 * 지우는 쪽이 서버인 이유입니다. 어떤 쿼리가 화면에 필요하고 어떤 것이 계측용인지 아는 곳이 여기
 * 하나뿐입니다. 클라이언트가 현재 주소를 읽어 지우게 하면 두 곳이 같은 규칙을 따로 들게 됩니다.
 */
function urlWithoutLoginMarker(authError: string | undefined): string {
  return authError === undefined ? "/" : `/?auth_error=${encodeURIComponent(authError)}`;
}

/**
 * 세션 여부의 출처는 서버가 읽는 세션 쿠키 하나입니다. 쿠키가 없으면 로그인 화면, 있으면 Repository 선택부터 시작하는 흐름을 그립니다.
 * 로그아웃은 세션 삭제 뒤 `router.refresh()`로 여기를 다시 실행시켜 헤더와 화면을 함께 로그인 전 상태로 바꿉니다.
 * 그때 흐름 컴포넌트가 통째로 내려가므로 선택과 분석 상태도 함께 사라집니다.
 *
 * 로그인 결과 판정도 여기서 합니다. 세션 유무를 아는 쪽이 서버이기 때문입니다. 성공과 실패 모두
 * OAuth 라우트가 붙여 주는 일회성 표시 `login`으로만 갈립니다. `auth_error`가 있다는 사실로 실패를
 * 세면 그 주소를 새로고침할 때마다 같은 실패가 다시 세어집니다. 성공은 표시를 지우는데 실패는 지우지
 * 않아 둘의 세는 방식이 어긋나 있었습니다(PR #129 리뷰).
 */
export default async function Home({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  const sessionCookie = cookieStore.get(GITHUB_SESSION_COOKIE);
  const authError = firstValue(params.auth_error);
  const loginMarker = firstValue(params.login);

  if (!sessionCookie) {
    const loginResult: LoginResult | undefined =
      loginMarker === "failed"
        ? { success: false, errorKind: authError === undefined ? "unknown" : toAuthErrorParam(authError) }
        : undefined;
    return (
      <>
        <AnalyticsSession
          userId={null}
          signedIn={false}
          loginResult={loginResult}
          urlAfterReport={urlWithoutLoginMarker(authError)}
        />
        <LoginScreen authError={authError} withdrawn={firstValue(params.withdrawn)} />
        {/*
          법적 고지 링크는 로그인 화면 밖에 둡니다. 그 화면은 상태가 셋이고 인증 중과 오류는
          `StatusScreen`이라 동의 문장이 없습니다. 안쪽에 두면 세 상태 중 하나에서만 링크가 보입니다.
          로그인한 뒤에는 계정 메뉴가 같은 역할을 합니다(이슈 #141).
        */}
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AnalyticsSession
        userId={analyticsUserIdFrom(sessionCookie.value)}
        signedIn
        loginResult={loginMarker === "success" ? { success: true } : undefined}
        urlAfterReport={urlWithoutLoginMarker(authError)}
      />
      <RepositoryFlow />
    </>
  );
}
