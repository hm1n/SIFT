"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { highlightCode } from "./syntax-highlighter";
import styles from "./interview-stream-view.module.css";

/**
 * react-markdown이 넘겨 주는 hast 노드에서 필요한 부분만 봅니다. `pre`를 가로채면 코드 블록과
 * 인라인 코드를 구분하려고 추측할 필요가 없습니다. `pre`의 자식은 항상 `code` 하나입니다.
 */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
  position?: { end?: { offset?: number } };
}

function readCodeNode(node: HastNode | undefined): {
  code: string;
  language: string | undefined;
  endOffset: number;
} | null {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  if (!codeNode) return null;
  const code = (codeNode.children ?? [])
    .filter((child) => child.type === "text")
    .map((child) => child.value ?? "")
    .join("");
  const className = codeNode.properties?.className;
  const languageClass = (Array.isArray(className) ? className : [])
    .map(String)
    .find((name) => name.startsWith("language-"));
  return {
    code,
    language: languageClass?.slice("language-".length),
    endOffset: node?.position?.end?.offset ?? 0,
  };
}

interface CodeBlockProps {
  code: string;
  language: string | undefined;
  /** 코드 펜스가 닫혔는지 여부입니다. 닫히기 전에는 highlight하지 않습니다. */
  complete: boolean;
}

/**
 * 측정 결과에 따라 미완성 코드에는 Syntax Highlighting을 적용하지 않습니다. 청크마다 highlight하면
 * 완료 후 한 번만 하는 것보다 10배가 들고, 미완성 코드는 문법이 깨져 있어 결과도 최종본과
 * 다릅니다.
 */
function CodeBlock({ code, language, complete }: CodeBlockProps) {
  // 어떤 코드에 대한 결과인지 함께 들고 있습니다. 코드가 바뀌면 이전 결과를 쓰면 안 되는데,
  // effect에서 초기화하는 대신 이렇게 비교하면 렌더가 한 번 더 돌지 않습니다.
  const [highlighted, setHighlighted] = useState<{ code: string; html: string } | null>(null);

  useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    highlightCode(code, language).then((html) => {
      if (!cancelled && html !== null) setHighlighted({ code, html });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, complete]);

  if (complete && highlighted?.code === code) {
    // shiki가 코드 텍스트를 이스케이프한 결과이므로 원문이 마크업으로 해석되지 않습니다.
    return <div className={styles.codeBlock} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
  }
  return (
    <pre className={styles.plainCode}>
      <code>{code}</code>
    </pre>
  );
}

export interface InterviewMessageProps {
  /** `question`은 모델이 만든 질문, `answer`는 사용자가 제출한 답변입니다. */
  role: "question" | "answer";
  text: string;
  /** 아직 도착 중인 메시지인지 여부입니다. 완료된 메시지는 다시 파싱하지 않습니다. */
  isStreaming: boolean;
}

/**
 * 메시지 하나를 Markdown으로 렌더합니다.
 *
 * `memo`로 감싼 이유는 측정 결과입니다. 대화 전체를 다시 렌더하면 청크당 6.75밀리초가 들지만
 * 스트리밍 중인 마지막 메시지만 렌더하면 0.13밀리초입니다. 완료된 메시지는 내용이 더 바뀌지
 * 않으므로 다시 파싱할 이유가 없습니다.
 */
const ROLE_LABEL = { question: "AI 질문", answer: "내 답변" } as const;

export const InterviewMessage = memo(function InterviewMessage({
  role,
  text,
  isStreaming,
}: InterviewMessageProps) {
  const components = useMemo<Components>(
    () => ({
      pre(props) {
        const parsed = readCodeNode(props.node as HastNode | undefined);
        if (!parsed) return <pre className={styles.plainCode}>{props.children}</pre>;
        // 스트리밍 중이면서 코드 블록이 원문의 끝까지 이어지면 아직 펜스가 닫히지 않은 것입니다.
        const complete = !isStreaming || parsed.endOffset < text.length;
        return <CodeBlock code={parsed.code} language={parsed.language} complete={complete} />;
      },
    }),
    [isStreaming, text.length]
  );

  // 누가 말한 것인지는 색이 아니라 글자로 구분합니다. 답변도 질문과 같은 Markdown 렌더러를 씁니다.
  // 사용자가 코드 블록을 답변에 붙이는 경우가 있고, 답변은 제출 즉시 확정되므로 다시 파싱하지
  // 않습니다.
  return (
    <article className={styles.message} data-role={role} aria-label={ROLE_LABEL[role]}>
      <p className={styles.roleLabel}>{ROLE_LABEL[role]}</p>
      <Markdown components={components}>{text}</Markdown>
    </article>
  );
});
