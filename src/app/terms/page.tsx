import type { Metadata } from "next";
import { TERMS_OF_SERVICE } from "@/copy/legal";
import { LegalDocument } from "@/features/legal/legal-document";
import { SiteFooter } from "@/components/shell/site-footer";
import { LEGAL_PAGE_METADATA } from "@/copy/shell";

/**
 * 이용약관 화면입니다(이슈 #141). 로그인 여부를 보지 않는 이유는 처리방침 화면과 같습니다.
 */
export const metadata: Metadata = LEGAL_PAGE_METADATA.terms;

export default function TermsOfServicePage() {
  return (
    <>
      <LegalDocument document={TERMS_OF_SERVICE} />
      {/* 두 문서 사이를 오갈 방법이 여기뿐입니다. 푸터는 `main` 밖에 둬야 contentinfo landmark가 됩니다. */}
      <SiteFooter />
    </>
  );
}
