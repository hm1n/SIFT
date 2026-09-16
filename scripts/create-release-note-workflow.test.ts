import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 릴리즈 자동화는 배포가 끝난 뒤에만 도는데, 조건이 안 맞으면 job이 조용히 skip돼 실패가 드러나지 않습니다.
 * PR #133 리뷰에서 실제로 두 가지가 같은 방식으로 깨졌습니다. 프로젝트 이름으로 거르는 조건이 이름 변경
 * (`demian` → `sift`)으로 안 맞게 됐고, preview 배포와 production 배포를 구분하지 못했습니다.
 * 워크플로우는 CI가 없어 실행으로 검증할 수 없으므로, 판별 조건이 되돌아가지 않는지만 여기서 잠급니다.
 */
const WORKFLOW = readFileSync(
  fileURLToPath(new URL("../.github/workflows/create-release-note.yml", import.meta.url)),
  "utf8"
);

describe("create-release-note 워크플로우", () => {
  it("deployment_status 이벤트로 트리거한다", () => {
    expect(WORKFLOW).toMatch(/^on:\r?\n\s+deployment_status:/m);
  });

  it("status 이벤트를 쓰지 않는다", () => {
    // `status`는 preview와 production이 같은 context로 오므로 둘을 구분할 수 없습니다.
    expect(WORKFLOW).not.toMatch(/^on:\r?\n\s+status:/m);
  });

  it("environment가 Production인 배포만 통과시킨다", () => {
    expect(WORKFLOW).toContain("github.event.deployment.environment == 'Production'");
  });

  it("배포 성공 상태와 vercel[bot] 발신자를 함께 확인한다", () => {
    expect(WORKFLOW).toContain("github.event.deployment_status.state == 'success'");
    expect(WORKFLOW).toContain("github.event.sender.login == 'vercel[bot]'");
  });

  it("태그를 붙일 커밋을 deployment.sha에서 읽는다", () => {
    expect(WORKFLOW).toMatch(/EVENT_SHA:\s*\$\{\{\s*github\.event\.deployment\.sha\s*\}\}/);
  });

  it("Vercel 프로젝트 이름으로 배포를 판별하지 않는다", () => {
    // 프로젝트 이름은 언제든 바뀝니다. 바뀌면 조건이 조용히 안 맞게 되므로 대리 지표로 쓰지 않습니다.
    expect(WORKFLOW).not.toContain("vercel.com/hm1n/");
  });

  it("최소 권한 범위를 유지한다", () => {
    expect(WORKFLOW).toMatch(/^permissions:\r?\n\s+contents: write\r?\n\s+pull-requests: read/m);
  });
});
