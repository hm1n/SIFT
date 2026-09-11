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
