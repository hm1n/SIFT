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
 * 세션 여부의 출처는 서버가 읽는 세션 쿠키 하나입니다. 쿠키가 없으면 로그인 화면, 있으면 Repository 선택부터 시작하는 흐름을 그립니다.
 * 로그아웃은 세션 삭제 뒤 `router.refresh()`로 여기를 다시 실행시켜 헤더와 화면을 함께 로그인 전 상태로 바꿉니다.
 * 그때 흐름 컴포넌트가 통째로 내려가므로 선택과 분석 상태도 함께 사라집니다.
 *
 * 로그인 결과 판정도 여기서 합니다. 세션 유무를 아는 쪽이 서버이기 때문입니다. `auth_error`는 세션이
 * 없을 때만 실패로 봅니다. 로그인이 끝난 뒤 주소에 남은 쿼리는 오류가 아닙니다.
 */
export default async function Home({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  const sessionCookie = cookieStore.get(GITHUB_SESSION_COOKIE);
  const authError = firstValue(params.auth_error);

  if (!sessionCookie) {
    const loginResult: LoginResult | undefined =
      authError === undefined
        ? undefined
        : { success: false, errorKind: toAuthErrorParam(authError) };
    return (
      <>
        <AnalyticsSession userId={null} loginResult={loginResult} />
        <LoginScreen authError={authError} />
      </>
    );
  }

  return (
    <>
      <AnalyticsSession
        userId={analyticsUserIdFrom(sessionCookie.value)}
        loginResult={firstValue(params.login) === "success" ? { success: true } : undefined}
      />
      <RepositoryFlow />
    </>
  );
}
