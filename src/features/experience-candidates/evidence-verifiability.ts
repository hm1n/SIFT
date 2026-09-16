/**
 * 이슈 #32·#47이 결정한 판별 규칙입니다. 판별용 LLM 호출이나 문장 파싱 휴리스틱을 쓰지 않고
 * 화면 항목 단위로 고정된 값만 사용합니다. 규칙 원문은 `llm-wiki/wiki/2026-08-24-확인가능불가-구분-계약.md`에 있습니다.
 *
 * 문구 자체는 `@/copy/candidates`에 있습니다. 이 파일은 그 문구를 쓰는 자리를 가리키는 통로로만
 * 남습니다. `relatedShas`와 `citedFilePaths`에 `확인 가능` 태그를 씌우지 않는다는 판별 규칙이
 * 여기 주석에 있고, 그 규칙이 문구보다 오래 갑니다.
 */
export {
  AI_SELECTION_LABEL,
  EVIDENCE_VERIFIABILITY_NOTICE,
  RELATED_COMMITS_VERIFICATION_NOTICE,
  REPOSITORY_UNVERIFIABLE_ITEMS,
  REPOSITORY_VERIFIED_NOTICE,
  VERIFIABILITY_LABEL,
} from "@/copy/candidates";
