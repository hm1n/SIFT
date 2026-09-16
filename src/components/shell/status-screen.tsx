import type { ReactNode } from "react";
import { Button } from "./button";
import styles from "./status-screen.module.css";

export type StatusKind = "loading" | "empty" | "error";

export interface StatusScreenProps {
  /** 어떤 상태인지에 따라 스크린리더 역할과 기호가 갈립니다. 색으로만 구분하지 않기 위한 장치입니다. */
  kind: StatusKind;
  /** 대문자 mono 코드입니다. 예: `ANALYZING`, `NO CANDIDATES`, `ERROR 401`. */
  code: string;
  label: string;
  sub: ReactNode;
  action?: { label: string; onClick: () => void };
}

/*
 * 상태마다 기호를 함께 그립니다. 디자인은 상태 코드 문구만으로 구분하지만 이 프로젝트의 Constraint는
 * 색으로만 상태를 구분하지 않는 것이고, 기호가 있으면 코드 문구를 읽지 않아도 상태가 갈립니다.
 */
const SYMBOL: Record<StatusKind, string> = { loading: "●", empty: "○", error: "✕" };

/**
 * Loading, Empty, Error를 한 형식으로 그리는 공용 상태 화면입니다. 디자인 파일 `App.tsx`의 `StatusScreen`을 옮겼습니다.
 *
 * Error는 `role="alert"`로 즉시 낭독하고, Loading과 Empty는 `role="status"`로 조용히 알립니다.
 * 기존 화면의 `data-*-kind` 속성과 같은 자리를 `data-status-kind`로 남겨 테스트가 상태를 고를 수 있게 합니다.
 */
export function StatusScreen({ kind, code, label, sub, action }: StatusScreenProps) {
  return (
    <section
      className={`${styles.screen} ${kind === "loading" ? styles.loading : ""}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? undefined : "polite"}
      data-status-kind={kind}
    >
      <span className={styles.code}>
        <span className={styles.symbol} aria-hidden="true">{SYMBOL[kind]}</span>
        {code}
      </span>
      <div className={styles.copy}>
        <p className={styles.label}>{label}</p>
        <p className={styles.sub}>{sub}</p>
      </div>
      {action ? (
        <Button className={styles.action} variant="secondary" onClick={action.onClick}>{action.label}</Button>
      ) : null}
    </section>
  );
}
