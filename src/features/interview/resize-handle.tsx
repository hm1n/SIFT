"use client";

import { useRef } from "react";
import styles from "./resize-handle.module.css";

/** 키보드 한 번에 움직이는 폭입니다. 한 번에 너무 조금 움직이면 최소·최대까지 수십 번 눌러야 합니다. */
export const RESIZE_KEYBOARD_STEP_PX = 16;

interface ResizeHandleProps {
  /** 무엇의 폭을 바꾸는 손잡이인지입니다. 손잡이 둘의 이름이 같으면 구분할 수 없습니다. */
  label: string;
  /** 지금 폭입니다. 스크린리더가 읽는 값이라 조절 대상 패널의 폭을 그대로 넘깁니다. */
  width: number;
  min: number;
  max: number;
  /** 오른쪽으로 끈 거리입니다. 왼쪽이면 음수입니다. 부호를 폭에 어떻게 반영할지는 쓰는 쪽이 정합니다. */
  onResize: (deltaX: number) => void;
}

/**
 * 두 열 사이의 폭 조절 손잡이입니다.
 *
 * 디자인 원본(`App.tsx`의 `ResizeHandle`)은 `mousedown`과 `window`의 `mousemove`만 씁니다. 그대로
 * 옮기면 키보드로도 터치로도 폭을 바꿀 수 없어, 포인터 이벤트로 바꾸고 화살표 키를 더했습니다.
 * `setPointerCapture`를 쓰면 포인터가 손잡이 밖으로 나가도 이벤트가 계속 와서 `window` 리스너를
 * 직접 붙였다 떼는 일이 필요 없습니다.
 */
export function ResizeHandle({ label, width, min, max, onResize }: ResizeHandleProps) {
  const lastX = useRef<number | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function drag(event: React.PointerEvent<HTMLDivElement>) {
    if (lastX.current === null) return;
    onResize(event.clientX - lastX.current);
    lastX.current = event.clientX;
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (lastX.current === null) return;
    lastX.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function step(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(event.key === "ArrowLeft" ? -RESIZE_KEYBOARD_STEP_PX : RESIZE_KEYBOARD_STEP_PX);
  }

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={step}
    />
  );
}
