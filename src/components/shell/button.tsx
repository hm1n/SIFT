import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "default" | "large";

/** 세 종류 버튼이 공유하는 클래스 이름입니다. `<button>`과 `<a>` 양쪽에 씁니다. */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize = "default", extra?: string) {
  return [styles.button, styles[variant], size === "large" ? styles.large : "", extra ?? ""].filter(Boolean).join(" ");
}

interface VariantProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps) {
  return <button type={type} className={buttonClassName(variant, size, className)} {...rest} />;
}

/** 링크로 동작하는 버튼입니다. GitHub 로그인처럼 서버 라우트로 이동하는 액션에 씁니다. */
export function ButtonLink({ variant = "secondary", size, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps) {
  return <a className={buttonClassName(variant, size, className)} {...rest} />;
}
