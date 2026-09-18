import type { Metadata } from "next";
import { PRIVACY_POLICY } from "@/copy/legal";
import { LegalDocument } from "@/features/legal/legal-document";
import { LEGAL_PAGE_METADATA } from "@/copy/shell";

/**
 * 개인정보 처리방침 화면입니다(이슈 #141).
 *
 * 로그인 여부를 보지 않습니다. 작성지침 Part 02는 로그인 여부와 상관없이 정보주체 누구나 쉽게
 * 확인할 수 있어야 한다고 요구합니다. 세션 쿠키를 읽지 않으므로 이 화면은 정적으로 그려집니다.
 */
export const metadata: Metadata = LEGAL_PAGE_METADATA.privacy;

export default function PrivacyPolicyPage() {
  return <LegalDocument document={PRIVACY_POLICY} />;
}
