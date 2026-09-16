import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";

function buttonClassName(variant: ButtonVariant, extra?: string) {
  return [styles.button, styles[variant], extra ?? ""].filter(Boolean).join(" ");
}

interface VariantProps {
  variant?: ButtonVariant;
}

export function Button({ variant = "secondary", className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...rest} />;
}

/** 링크로 동작하는 버튼입니다. GitHub 로그인처럼 서버 라우트로 이동하는 액션에 씁니다. */
export function ButtonLink({ variant = "secondary", className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps) {
  return <a className={buttonClassName(variant, className)} {...rest} />;
}
