"use client";

import { createContext, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { TOP_HEADER_COPY } from "@/copy/shell";
import { trackEvent } from "@/features/analytics/events";
import { LOGIN_PATH } from "@/lib/github/auth-paths";
import { ButtonLink, type ButtonVariant } from "./button";
import { GitHubIcon } from "./sift-mark";

interface AuthTransition {
  /** 로그인 링크를 눌러 브라우저가 로그인 라우트로 이동하는 중인지입니다. */
  isAuthenticating: boolean;
  startAuthentication: () => void;
}

const AuthTransitionContext = createContext<AuthTransition | null>(null);

/**
 * GitHub 로그인 진입점은 둘입니다. 상단 헤더의 `GitHub으로 로그인`과 로그인 화면의 `GitHub으로 계속하기`입니다.
 * 헤더는 layout이, 로그인 화면은 page가 그리므로 인증 중 상태를 한쪽의 로컬 상태로 두면 다른 진입점이 닿지 못합니다.
 * PR #100 리뷰가 이 지점이었습니다. layout이 이 provider로 헤더와 화면을 함께 감싸 두 진입점이 같은 상태를 봅니다.
 */
export function AuthTransitionProvider({ children }: { children: ReactNode }) {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  /**
   * 이 시도를 이미 시작했는지입니다. 상태가 아니라 ref인 것은 클릭 처리 도중에 곧바로 읽어야 하기
   * 때문입니다. `isAuthenticating`은 다시 그린 뒤에야 true가 되므로, 첫 클릭의 기본 이동이 일어나기
   * 전에 도착한 두 번째 클릭을 막지 못합니다.
   */
  const startedRef = useRef(false);

  // 뒤로 가기로 bfcache에서 복원되면 클릭 시점의 상태가 그대로 살아 있습니다. 화면이 인증 중에 멈춰 보이지 않게 되돌립니다.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      setIsAuthenticating(false);
      // 되돌아온 화면에서 다시 로그인할 수 있어야 하므로 시도 표시도 함께 되돌립니다.
      startedRef.current = false;
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  /**
   * 로그인 시도 한 번의 시작입니다. 계측도 여기서 합니다.
   *
   * 링크 쪽이 아니라 이 자리인 이유가 둘입니다. 진입점이 헤더와 로그인 화면 둘이라 두 링크를
   * 잇달아 누르면 한 번의 시도가 두 번 세어집니다. 연속 클릭도 마찬가지입니다. `<a href>`는
   * 기본 이동을 막지 않으므로 떠나기 전에 여러 번 눌릴 수 있습니다. "시도 한 번"을 아는 곳이
   * 공용 상태를 들고 있는 여기이므로 가드와 계측을 함께 둡니다(PR #129 리뷰).
   */
  const startAuthentication = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setIsAuthenticating(true);
    trackEvent({ name: "login_start" });
  }, []);

  return (
    <AuthTransitionContext.Provider value={{ isAuthenticating, startAuthentication }}>
      {children}
    </AuthTransitionContext.Provider>
  );
}

/** provider 밖에서 쓰면 인증 중 상태가 조용히 사라지므로 예외로 알립니다. */
export function useAuthTransition(): AuthTransition {
  const context = useContext(AuthTransitionContext);
  if (!context) throw new Error("useAuthTransition은 AuthTransitionProvider 안에서만 쓸 수 있습니다.");
  return context;
}

/** 새 탭이나 창으로 여는 클릭입니다. 현재 화면은 그대로 남으므로 인증 중 상태로 바꾸지 않습니다. */
function opensInCurrentTab(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface LoginLinkProps {
  variant: ButtonVariant;
  className?: string;
  iconSize: number;
  children: ReactNode;
}

/**
 * GitHub 로그인 링크입니다. 이동은 `<a href>`에 맡기고 클릭에서는 공용 인증 중 상태만 세웁니다.
 * 내부 경로에 `window.location.assign`을 쓰는 것은 lint가 막습니다. 인증 중에는 문구를 바꾸고 `aria-busy`를 붙여
 * 로그인 화면이 없는 자리에서도 상태가 보이게 합니다.
 */
export function LoginLink({ variant, className, iconSize, children }: LoginLinkProps) {
  const { isAuthenticating, startAuthentication } = useAuthTransition();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // 새 탭으로 여는 클릭은 현재 화면을 떠나지 않으므로 시도로 세지 않습니다.
    if (!opensInCurrentTab(event)) return;
    startAuthentication();
  }

  return (
    <ButtonLink variant={variant} className={className} href={LOGIN_PATH} onClick={handleClick} aria-busy={isAuthenticating || undefined}>
      <GitHubIcon size={iconSize} />
      {isAuthenticating ? TOP_HEADER_COPY.connecting : children}
    </ButtonLink>
  );
}
