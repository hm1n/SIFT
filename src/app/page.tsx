import { LoginScreen } from "@/features/auth/login-screen";
import { RepositoryAnalysisView } from "@/features/repository-analysis/repository-analysis-view";
import { GITHUB_SESSION_COOKIE } from "@/lib/github/auth-session";
import { cookies } from "next/headers";
import styles from "./page.module.css";

/**
 * 세션 여부의 출처는 서버가 읽는 세션 쿠키 하나입니다. 쿠키가 없으면 로그인 화면, 있으면 분석 화면을 그립니다.
 * 로그아웃은 세션 삭제 뒤 `router.refresh()`로 여기를 다시 실행시켜 헤더와 화면을 함께 로그인 전 상태로 바꿉니다.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string | string[] }> }) {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  if (!cookieStore.has(GITHUB_SESSION_COOKIE)) {
    const authError = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
    return <LoginScreen authError={authError} />;
  }

  return (
    <div className={styles.page}>
      <RepositoryAnalysisView hasSession />
    </div>
  );
}
