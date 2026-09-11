/** 로고 마크입니다. 디자인 파일 `App.tsx`의 `SIFTMark`를 그대로 옮겼고 색은 부모의 `color`를 따릅니다. */
export function SiftMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="16" cy="4" r="1.5" opacity="0.17" />
      <circle cx="22" cy="5.5" r="1.4" opacity="0.15" />
      <circle cx="27" cy="10" r="1.5" opacity="0.17" />
      <circle cx="28.5" cy="16.5" r="1.4" opacity="0.15" />
      <circle cx="26.5" cy="22.5" r="1.5" opacity="0.17" />
      <circle cx="22" cy="27" r="1.4" opacity="0.15" />
      <circle cx="16" cy="28.5" r="1.5" opacity="0.17" />
      <circle cx="10" cy="27" r="1.4" opacity="0.15" />
      <circle cx="5.5" cy="22.5" r="1.5" opacity="0.17" />
      <circle cx="3.5" cy="16.5" r="1.4" opacity="0.15" />
      <circle cx="5" cy="10" r="1.5" opacity="0.17" />
      <circle cx="10" cy="5.5" r="1.4" opacity="0.15" />
      <circle cx="16" cy="8.5" r="1.0" opacity="0.25" />
      <circle cx="21.5" cy="11" r="0.9" opacity="0.23" />
      <circle cx="23.5" cy="16.5" r="1.0" opacity="0.25" />
      <circle cx="21.5" cy="22" r="0.9" opacity="0.23" />
      <circle cx="16" cy="24" r="1.0" opacity="0.25" />
      <circle cx="10.5" cy="22" r="0.9" opacity="0.23" />
      <circle cx="8.5" cy="16.5" r="1.0" opacity="0.25" />
      <circle cx="10.5" cy="11" r="0.9" opacity="0.23" />
      <circle cx="16" cy="12.5" r="0.75" opacity="0.32" />
      <circle cx="19" cy="16.5" r="0.7" opacity="0.28" />
      <circle cx="16" cy="20" r="0.75" opacity="0.32" />
      <circle cx="13" cy="16.5" r="0.7" opacity="0.28" />
      <circle cx="21.5" cy="21.5" r="2.5" opacity="1.0" />
    </svg>
  );
}

/** GitHub 마크입니다. 디자인 파일의 `GitHubIcon`과 같은 경로입니다. */
export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
