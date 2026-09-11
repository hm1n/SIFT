import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { AuthTransitionProvider } from "@/components/shell/auth-transition";
import { TopHeader } from "@/components/shell/top-header";
import { GITHUB_SESSION_COOKIE } from "@/lib/github/auth-session";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/*
 * Pretendard는 Google Fonts에 없어 next/font/google로 등록할 수 없습니다. 디자인 파일과 같은 CDN 스타일시트를 씁니다.
 * 자체 호스팅은 한국어 입력 화면이 생기는 #95에서 실측 후 판단합니다. llm-wiki 디자인 개편 backlog 7번입니다.
 */
const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css";

export const metadata: Metadata = {
  title: "SIFT | Repository 분석",
  description: "실제 GitHub Repository 근거로 개발 경험을 발견합니다.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  return (
    <html lang="ko" className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD_CSS} />
      </head>
      <body>
        {/* 헤더와 화면의 로그인 진입점이 같은 인증 중 상태를 보도록 둘을 함께 감쌉니다. */}
        <AuthTransitionProvider>
          <TopHeader isAuthenticated={cookieStore.has(GITHUB_SESSION_COOKIE)} />
          {children}
        </AuthTransitionProvider>
      </body>
    </html>
  );
}
