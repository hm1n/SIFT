import Link from "next/link";
import { LoginLink } from "@/components/shell/auth-transition";
import { SiftMark } from "@/components/shell/sift-mark";
import { LANDING_COPY } from "@/copy/landing";
import { DOCUMENT_COPY, SITE_URL } from "@/copy/shell";
import { LandingProductPreview } from "./landing-product-preview";
import styles from "./landing-page.module.css";

const { hero, steps, coreModel, evidence, final } = LANDING_COPY;

/**
 * 검색엔진과 AI가 읽는 구조화 데이터입니다(이슈 #149).
 *
 * 둘을 함께 둡니다. `WebSite`는 이 주소가 무엇인지, `SoftwareApplication`은 무엇을 하는 도구인지
 * 말합니다. 랜딩 하나가 두 역할을 겸하므로 `@graph`로 묶어 한 번에 내보냅니다.
 *
 * `url`은 `SITE_URL` 그대로입니다. 뒤에 `/`를 붙이지 않는 이유는 Next가 만드는 canonical과
 * `og:url`이 끝의 `/`를 떼기 때문입니다. 같은 화면을 가리키는 세 값이 서로 다른 모양이면 안 됩니다.
 *
 * 가격 정보(`offers`)를 넣지 않습니다. 정해진 과금 정책이 없어 무료라고 단정할 수 없습니다.
 * Hero에서 `무료 · 카드 등록 불필요` 문구를 뺀 것과 같은 이유입니다.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "SIFT",
      description: DOCUMENT_COPY.description,
      inLanguage: "ko-KR",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#application`,
      name: "SIFT",
      url: SITE_URL,
      description: DOCUMENT_COPY.description,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      inLanguage: "ko-KR",
    },
  ],
};

/**
 * 비로그인 `/`가 그리는 랜딩입니다(이슈 #149). 레퍼런스 `App.tsx`의 `LandingPage`(2039줄)와
 * 스펙 `sift-landing-page.md`를 옮겼습니다.
 *
 * 서버 컴포넌트입니다. 상태를 가르는 `UnauthenticatedScreen`이 클라이언트라 그 안에 직접 넣으면
 * 이 정적 마크업 전체가 JS 번들에 실립니다. `page.tsx`가 이 화면을 그려 `children`으로 넘기는
 * 이유입니다. 안에서 누를 수 있는 것은 클라이언트인 `LoginLink`와 약관 링크뿐입니다.
 *
 * 헤더와 푸터를 여기서 그리지 않습니다. 레퍼런스 랜딩은 자기 헤더와 푸터를 들고 있지만 이
 * 저장소에는 이미 같은 모양의 `TopHeader`(layout)와 `SiteFooter`(`page.tsx`)가 있습니다. 레퍼런스
 * 푸터의 태그라인 자리를 법적 고지 링크가 대신하고 있고 그 사유는 `site-footer.tsx`에 있습니다.
 * 언어 선택기는 #128이 KO 단일로 정해 옮기지 않았습니다.
 *
 * CTA는 Hero와 마지막 둘입니다. 스펙이 "경쟁하는 CTA를 늘리지 말라"고 해서 두 자리 모두 같은
 * `LoginLink`이고, 헤더 로그인과 인증 중 상태를 공유합니다. 어느 쪽을 눌러도 화면이 함께
 * AUTHENTICATING으로 바뀝니다.
 */
export function LandingPage() {
  return (
    <main className={styles.landing}>
      <script
        type="application/ld+json"
        // JSON 안의 `<`를 이스케이프합니다. 값이 전부 이 저장소의 상수라 위험한 문자는 없지만,
        // 나중에 바깥 값이 섞여 들어와도 `</script>`로 태그가 닫히지 않게 막아 둡니다.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }}
      />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{hero.tagline}</p>
          <h1 className={styles.headline}>
            {hero.headline[0]}
            <br />
            {hero.headline[1]}
          </h1>
          <p className={styles.subtext}>
            {hero.subtext.map((line, index) => (
              <span key={line}>
                {index > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
          <LoginLink variant="primary" className={styles.cta} iconSize={15}>
            {LANDING_COPY.cta}
          </LoginLink>
        </div>
        {/* 브랜드 마크를 크게 한 번 씁니다. 스펙이 "반복하는 무늬로 쓰지 말라"고 해서 여기와 마지막 CTA 둘뿐입니다. */}
        <div className={styles.heroMark} aria-hidden="true">
          <SiftMark size={180} />
        </div>
      </section>

      {/* 이름은 안쪽 `role="img"`가 답니다. 여기에도 달면 같은 문장이 두 번 읽힙니다. */}
      <section className={styles.previewSection}>
        <LandingProductPreview />
      </section>

      <section className={styles.stepsSection} aria-label={steps.sectionLabel}>
        <div className={styles.inner}>
          <ol className={styles.steps}>
            {steps.items.map((step, index) => (
              <li key={step.label} className={styles.step}>
                {/* 번호는 순서에서 만듭니다. `01`~`04`를 문구로 두면 순서와 어긋날 수 있습니다. */}
                <span className={styles.stepNumber} aria-hidden="true">{`0${index + 1}`}</span>
                {/* 라벨과 설명을 한 덩어리로 묶습니다. 번호와의 간격이 둘 사이 간격보다 넓습니다. */}
                <div className={styles.stepBody}>
                  <p className={styles.stepLabel}>{step.label}</p>
                  <p className={styles.stepDescription}>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.coreModelSection}>
        <div className={styles.inner}>
          <div className={styles.sectionHead}>
            <h2 className={styles.eyebrow}>{coreModel.title}</h2>
            <span className={styles.rule} aria-hidden="true" />
            {/* 세 열의 순서를 한 줄로 요약합니다. 아래 표와 같은 내용이라 보조기술에는 숨깁니다. */}
            <p className={styles.flow} aria-hidden="true">
              {coreModel.flow.map((name, index) => (
                <span key={name}>
                  {index > 0 ? <span className={styles.flowArrow}>→</span> : null}
                  <span className={styles.flowName}>{name}</span>
                </span>
              ))}
            </p>
          </div>
          <div className={styles.columns}>
            {coreModel.columns.map((column) => (
              <div key={column.label} className={styles.column}>
                <p className={styles.columnLabel}>{column.label}</p>
                <p className={styles.columnQuestion}>{column.question}</p>
                <p className={styles.columnDescription}>{column.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.evidenceSection}>
        <div className={styles.innerSplit}>
          <div className={styles.evidenceCopy}>
            <h2 className={styles.eyebrow}>{evidence.title}</h2>
            <p className={styles.sectionHeadline}>
              {evidence.headline[0]}
              <br />
              {evidence.headline[1]}
            </p>
            <p className={styles.evidenceSubtext}>{evidence.subtext}</p>
          </div>
          <dl className={styles.samples}>
            {evidence.samples.map((sample) => (
              <div key={sample.tag} className={styles.sample}>
                <dt className={styles.sampleTag}>{sample.tag}</dt>
                <dd className={styles.sampleBody}>
                  <span className={styles.sampleValue}>{sample.value}</span>
                  <span className={styles.sampleSub}>{sample.sub}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className={styles.finalSection}>
        <div className={styles.finalInner}>
          <div className={styles.finalMark} aria-hidden="true">
            <SiftMark size={280} />
          </div>
          <div className={styles.finalCopy}>
            <h2 className={styles.eyebrow}>{final.label}</h2>
            <p className={styles.finalHeadline}>
              {final.headline[0]}
              <br />
              {final.headline[1]}
            </p>
            <LoginLink variant="primary" className={styles.cta} iconSize={15}>
              {LANDING_COPY.cta}
            </LoginLink>
            {/*
              약관 동의 문장입니다. 로그인 카드가 쓰던 것과 같은 조각이라 `이용약관`만 링크입니다.
              처리방침은 동의 대상이 아니라 이 문장에 넣지 않고 푸터가 답니다(이슈 #141).
            */}
            <p className={styles.terms}>
              {LANDING_COPY.termsSentence.lead}
              <Link className={styles.termsLink} href="/terms">
                {LANDING_COPY.termsSentence.link}
              </Link>
              {LANDING_COPY.termsSentence.tail}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
