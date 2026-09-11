/**
 * `measure-pipeline.ts`의 `--synthetic-units` 실험이 커밋 단위 복제본에 붙이는 대표 SHA입니다.
 *
 * 단일 커밋 단위는 모델에게 `modelFacingUnitId`가 자른 SHA 앞 7자리만 보입니다. `index`를
 * 뒤에서부터 채우면(`padStart`) 실험 규모에서 흔히 쓰는 index 값은 16진수 자릿수가 몇 자리뿐이라
 * 앞 7자리가 전부 "0000000"으로 겹쳐, 서로 다른 복제본이 모델에게 완전히 같은 식별자로 보입니다
 * (Codex 리뷰, 이슈 #101). index를 앞자리에 채워야 그 7자리가 index마다 달라집니다.
 *
 * `measure-pipeline.ts`는 top-level에서 `process.argv`를 읽는 CLI라 가져오는 것만으로 테스트
 * 러너가 죽습니다. 이 계산만 부작용 없는 별도 파일로 떼어 회귀 테스트가 CLI 실행 없이 바로 이
 * 함수를 확인할 수 있게 합니다.
 */
export function syntheticCommitSha(index: number): string {
  return `${index.toString(16).padStart(7, "0")}${"0".repeat(33)}`;
}

/**
 * PR 단위 복제본의 합성 unitId입니다. 라우트 검증(`UNIT_ID_PATTERN`)과 시스템 프롬프트 둘 다
 * `pr:숫자` 형식만 허용하므로, 라운드를 문자열 접미사로 붙이면(`pr:12-round1`) 이 스크립트가
 * 재는 입력을 실제 요청으로 보낼 수 없고 모델이 접미사를 어떻게 다루는지에 따라 전수 응답 결과가
 * 흔들립니다(Codex 리뷰, 이슈 #101). 라운드마다 번호에 오프셋을 더해 숫자 형식을 유지합니다.
 */
export function syntheticPullRequestUnitId(sourceUnitId: string, round: number): string {
  const number = Number(sourceUnitId.slice("pr:".length));
  return `pr:${number + round * 10_000}`;
}
