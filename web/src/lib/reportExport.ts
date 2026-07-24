export type AuditReportData = {
  companyName: string;
  sourceLabel: string;
  generatedAt: string;
  unit: string;
  /** 조서 참조번호(W/P ref) */
  workpaperRef: string;
  /** 대상기간(사업연도) */
  period: string;
  /** 중요성 기준(이상변동 판정 근거) */
  materialityBasis: string;
  ratioGroups: { category: string; ratios: { label: string; value: string }[] }[];
  abnormalAccounts: {
    account: string;
    prior: string;
    current: string;
    changeRate: string;
  }[];
  beneish: { score: string; verdict: string } | null;
  altman: { score: string; verdict: string } | null;
  benford: { chiSquare: string; sampleSize: number; verdict: string } | null;
  rsfFlags: { account: string; detail: string }[];
  roundTripFlags: { detail: string }[];
  checklist: { risk: string; procedure: string; isaReference: string }[] | null;
};

/** 이상탐지·분석적 절차에서 '검토 필요'로 표시된 항목 수. 결론 문단의 근거로 쓴다. */
function countRiskFlags(data: AuditReportData): number {
  let n =
    data.abnormalAccounts.length +
    data.rsfFlags.length +
    data.roundTripFlags.length;
  if (data.beneish && data.beneish.verdict !== "정상 범위") n += 1;
  if (data.altman && data.altman.verdict === "위험지대") n += 1;
  if (data.benford && data.benford.verdict !== "정상 범위") n += 1;
  return n;
}

/** 감사인이 확정할 결론 초안 문장. 스크리닝 결과 요약 + 서명 전 빈 결론란. */
function buildConclusionText(data: AuditReportData): string {
  const n = countRiskFlags(data);
  return n === 0
    ? "분석적 절차·이상탐지 결과, 추가 검토가 필요한 예외항목은 식별되지 않았다. 다만 본 결과는 스크리닝 지표이므로 감사인은 절차의 충분성을 별도로 판단한다."
    : `분석적 절차·이상탐지 결과, 추가 검토가 필요한 항목 ${n}건이 식별되었다. 각 항목은 부정·오류를 확정하는 감사증거가 아닌 스크리닝 지표이며, 감사인은 이를 개별 확인하여 최종 판단한다.`;
}

/** tickmark(감사 표기) 범례 — 조서에 표기를 남길 때의 관례. */
const TICKMARKS: { mark: string; meaning: string }[] = [
  { mark: "✓", meaning: "원장·명세서와 대사(agree) 완료" },
  { mark: "Σ", meaning: "합계 재계산(footing) 검증" },
  { mark: "CX", meaning: "타 조서·증빙과 상호참조(cross-reference)" },
  { mark: "Ø", meaning: "예외항목 — 추가 감사절차 필요" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildReportHtml(data: AuditReportData): string {
  const ratioSections = data.ratioGroups
    .map(
      (group) => `
        <h3>${escapeHtml(group.category)}</h3>
        <table>
          <thead><tr><th>지표</th><th>값</th></tr></thead>
          <tbody>
            ${group.ratios
              .map(
                (r) =>
                  `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>`
    )
    .join("");

  const abnormalRows =
    data.abnormalAccounts.length === 0
      ? `<p class="muted">이상 변동으로 표시된 계정이 없습니다.</p>`
      : `<table>
          <thead><tr><th>계정과목</th><th>전기</th><th>당기</th><th>증감율</th></tr></thead>
          <tbody>
            ${data.abnormalAccounts
              .map(
                (a) =>
                  `<tr><td>${escapeHtml(a.account)}</td><td>${escapeHtml(a.prior)}</td><td>${escapeHtml(a.current)}</td><td>${escapeHtml(a.changeRate)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>`;

  const rsfRows = data.rsfFlags.length
    ? `<ul>${data.rsfFlags
        .map((f) => `<li>${escapeHtml(f.account)} — ${escapeHtml(f.detail)}</li>`)
        .join("")}</ul>`
    : `<p class="muted">이상치로 플래그된 계정이 없습니다.</p>`;

  const roundTripRows = data.roundTripFlags.length
    ? `<ul>${data.roundTripFlags
        .map((f) => `<li>${escapeHtml(f.detail)}</li>`)
        .join("")}</ul>`
    : `<p class="muted">의심되는 라운드트립 거래가 없습니다.</p>`;

  const checklistSection =
    data.checklist && data.checklist.length > 0
      ? `<h2>4. 감사 체크리스트 (AI 초안)</h2>
         ${data.checklist
           .map(
             (item, i) => `
              <div class="checklist-item">
                <p class="risk">${i + 1}. ${escapeHtml(item.risk)}</p>
                <p>${escapeHtml(item.procedure)}</p>
                <p class="isa">${escapeHtml(item.isaReference)}</p>
              </div>`
           )
           .join("")}`
      : "";

  const idRow = (label: string, value: string) =>
    `<tr><th class="idlabel">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;

  const tickmarkRows = TICKMARKS.map(
    (t) => `<tr><td class="tm">${t.mark}</td><td>${escapeHtml(t.meaning)}</td></tr>`
  ).join("");

  return `
    <div class="report-root">
      <style>
        .report-root { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #0f172a; width: 760px; padding: 32px; background: #ffffff; }
        .report-root h1 { font-size: 20px; margin: 0 0 2px; }
        .report-root .subtitle { font-size: 12px; color: #64748b; margin: 0 0 16px; }
        .report-root h2 { font-size: 15px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #0f172a; }
        .report-root h3 { font-size: 13px; margin: 14px 0 6px; color: #334155; }
        .report-root table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
        .report-root th, .report-root td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
        .report-root th { background: #f1f5f9; }
        .report-root .idtable th.idlabel { width: 110px; background: #f8fafc; color: #475569; }
        .report-root .muted { font-size: 12px; color: #94a3b8; }
        .report-root ul { margin: 0 0 12px; padding-left: 18px; font-size: 12px; }
        .report-root .checklist-item { margin-bottom: 12px; font-size: 12px; }
        .report-root .checklist-item .risk { font-weight: 600; margin-bottom: 4px; }
        .report-root .checklist-item .isa { color: #1d4ed8; margin-top: 4px; }
        .report-root .concl { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 12px; }
        .report-root .concl .blank { display:block; margin-top:10px; border-top:1px solid #94a3b8; padding-top:4px; color:#94a3b8; }
        .report-root .signoff td { height: 46px; }
        .report-root .tm { text-align:center; font-weight:600; width:48px; }
        .report-root .disclaimer { margin-top: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
      </style>
      <h1>${escapeHtml(data.companyName)} — 분석적검토 감사조서 (초안)</h1>
      <p class="subtitle">ISA 520 분석적 절차 · ISA 240 부정위험 스크리닝 기반 · 조서번호 ${escapeHtml(data.workpaperRef)}</p>

      <table class="idtable">
        ${idRow("회사명", data.companyName)}
        ${idRow("대상기간", data.period)}
        ${idRow("자료 출처", data.sourceLabel)}
        ${idRow("금액 단위", data.unit)}
        ${idRow("조서번호", data.workpaperRef)}
        ${idRow("작성일시", data.generatedAt)}
      </table>

      <table class="signoff">
        <thead><tr><th>작성자</th><th>작성일</th><th>검토자</th><th>검토일</th></tr></thead>
        <tbody><tr><td></td><td></td><td></td><td></td></tr></tbody>
      </table>

      <h2>1. 감사 목적 · 범위 및 중요성</h2>
      <p style="font-size:12px;">대상 재무제표에 대해 ISA 520(분석적 절차) 및 ISA 240(부정에 대한 감사인의 책임)에 근거한 예비적 분석·이상탐지 절차를 수행하여, 추가 감사절차가 필요한 위험 신호를 식별한다. 본 조서의 산출물은 스크리닝 지표이며 부정·오류를 확정하는 감사증거가 아니다.</p>
      <h3>중요성 기준</h3>
      <p style="font-size:12px;">${escapeHtml(data.materialityBasis)}</p>

      <h2>2. 재무비율 분석</h2>
      ${ratioSections}

      <h2>3. 전기 대비 이상 변동 계정</h2>
      ${abnormalRows}

      <h2>4. 이상탐지 모델</h2>
      <p>Beneish M-Score: ${data.beneish ? `${escapeHtml(data.beneish.score)} (${escapeHtml(data.beneish.verdict)})` : "데이터 부족"}</p>
      <p>Altman Z&#39;-Score: ${data.altman ? `${escapeHtml(data.altman.score)} (${escapeHtml(data.altman.verdict)})` : "데이터 부족"}</p>
      <p>Benford&#39;s Law: ${data.benford ? `표본 ${data.benford.sampleSize}건 · 카이제곱 ${escapeHtml(data.benford.chiSquare)} — ${escapeHtml(data.benford.verdict)}` : "전표데이터 없음"}</p>
      <h3>RSF 테스트</h3>
      ${rsfRows}
      <h3>라운드트립(2자간 상계성 거래) 탐지</h3>
      ${roundTripRows}

      ${checklistSection}

      <h2>${data.checklist && data.checklist.length > 0 ? "6" : "5"}. 결론</h2>
      <div class="concl">
        <p>${escapeHtml(buildConclusionText(data))}</p>
        <span class="blank">감사인 종합 결론 (기입): ________________________________________________</span>
      </div>

      <h3>tickmark 범례</h3>
      <table><tbody>${tickmarkRows}</tbody></table>

      <p class="disclaimer">본 조서는 AI 기반 감사보조 분석 도구가 생성한 <b>초안</b>이며, 표시된 결과는 감사인의 추가 검토가 필요한 스크리닝 지표입니다. 조서번호·대상기간·중요성·작성자/검토자 및 최종 결론은 감사인이 검토·서명하여 확정해야 합니다.</p>
    </div>
  `;
}

export async function exportAuditReportPdf(data: AuditReportData): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.innerHTML = buildReportHtml(data);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
    });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    // 1pt 이하 잔여는 반올림 오차이므로 빈 페이지가 추가되지 않게 여유를 둔다.
    while (heightLeft > 1) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${data.companyName}_분석적검토조서_${data.generatedAt}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export async function exportAuditReportWord(data: AuditReportData): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import("docx");

  const headerRow = (labels: string[]) =>
    new TableRow({
      children: labels.map(
        (label) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: label, bold: true })],
              }),
            ],
          })
      ),
    });

  const dataRow = (values: string[]) =>
    new TableRow({
      children: values.map(
        (value) => new TableCell({ children: [new Paragraph(value)] })
      ),
    });

  const twoColRow = (label: string, value: string) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 22, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({ children: [new TextRun({ text: label, bold: true })] }),
          ],
        }),
        new TableCell({ children: [new Paragraph(value)] }),
      ],
    });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      text: `${data.companyName} — 분석적검토 감사조서 (초안)`,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph(
      `ISA 520 분석적 절차 · ISA 240 부정위험 스크리닝 기반 · 조서번호 ${data.workpaperRef}`
    ),
    // 조서 식별 정보
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        twoColRow("회사명", data.companyName),
        twoColRow("대상기간", data.period),
        twoColRow("자료 출처", data.sourceLabel),
        twoColRow("금액 단위", data.unit),
        twoColRow("조서번호", data.workpaperRef),
        twoColRow("작성일시", data.generatedAt),
      ],
    }),
    new Paragraph(""),
    // 작성자/검토자 사인란 (빈칸 — 감사인이 서명·기입)
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(["작성자", "작성일", "검토자", "검토일"]),
        dataRow(["", "", "", ""]),
      ],
    }),
    new Paragraph(""),
    new Paragraph({
      text: "1. 감사 목적 · 범위 및 중요성",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph(
      "대상 재무제표에 대해 ISA 520(분석적 절차) 및 ISA 240(부정에 대한 감사인의 책임)에 근거한 예비적 분석·이상탐지 절차를 수행하여, 추가 감사절차가 필요한 위험 신호를 식별한다. 본 조서의 산출물은 스크리닝 지표이며 부정·오류를 확정하는 감사증거가 아니다."
    ),
    new Paragraph({ text: "중요성 기준", heading: HeadingLevel.HEADING_2 }),
    new Paragraph(data.materialityBasis),
    new Paragraph({ text: "2. 재무비율 분석", heading: HeadingLevel.HEADING_1 }),
  ];

  for (const group of data.ratioGroups) {
    children.push(
      new Paragraph({ text: group.category, heading: HeadingLevel.HEADING_2 })
    );
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          headerRow(["지표", "값"]),
          ...group.ratios.map((r) => dataRow([r.label, r.value])),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      text: "3. 전기 대비 이상 변동 계정",
      heading: HeadingLevel.HEADING_1,
    })
  );
  if (data.abnormalAccounts.length === 0) {
    children.push(new Paragraph("이상 변동으로 표시된 계정이 없습니다."));
  } else {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          headerRow(["계정과목", "전기", "당기", "증감율"]),
          ...data.abnormalAccounts.map((a) =>
            dataRow([a.account, a.prior, a.current, a.changeRate])
          ),
        ],
      })
    );
  }

  children.push(
    new Paragraph({ text: "4. 이상탐지 모델", heading: HeadingLevel.HEADING_1 })
  );
  children.push(
    new Paragraph(
      `Beneish M-Score: ${data.beneish ? `${data.beneish.score} (${data.beneish.verdict})` : "데이터 부족"}`
    )
  );
  children.push(
    new Paragraph(
      `Altman Z'-Score: ${data.altman ? `${data.altman.score} (${data.altman.verdict})` : "데이터 부족"}`
    )
  );
  children.push(
    new Paragraph(
      `Benford's Law: ${data.benford ? `표본 ${data.benford.sampleSize}건 · 카이제곱 ${data.benford.chiSquare} — ${data.benford.verdict}` : "전표데이터 없음"}`
    )
  );
  data.rsfFlags.forEach((f) =>
    children.push(new Paragraph(`RSF 이상치: ${f.account} — ${f.detail}`))
  );
  data.roundTripFlags.forEach((f) =>
    children.push(new Paragraph(`라운드트립 의심: ${f.detail}`))
  );

  const hasChecklist = !!(data.checklist && data.checklist.length > 0);
  if (data.checklist && data.checklist.length > 0) {
    children.push(
      new Paragraph({
        text: "5. 감사 체크리스트 (AI 초안)",
        heading: HeadingLevel.HEADING_1,
      })
    );
    data.checklist.forEach((item, i) => {
      children.push(
        new Paragraph({
          text: `${i + 1}. ${item.risk}`,
          heading: HeadingLevel.HEADING_2,
        })
      );
      children.push(new Paragraph(item.procedure));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: item.isaReference, italics: true })],
        })
      );
    });
  }

  // 결론
  children.push(
    new Paragraph({
      text: `${hasChecklist ? "6" : "5"}. 결론`,
      heading: HeadingLevel.HEADING_1,
    })
  );
  children.push(new Paragraph(buildConclusionText(data)));
  children.push(
    new Paragraph(
      "감사인 종합 결론 (기입): ________________________________________________"
    )
  );

  // tickmark 범례
  children.push(
    new Paragraph({ text: "tickmark 범례", heading: HeadingLevel.HEADING_2 })
  );
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(["표기", "의미"]),
        ...TICKMARKS.map((t) => dataRow([t.mark, t.meaning])),
      ],
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "본 조서는 AI 기반 감사보조 분석 도구가 생성한 초안이며, 표시된 결과는 감사인의 추가 검토가 필요한 스크리닝 지표입니다. 조서번호·대상기간·중요성·작성자/검토자 및 최종 결론은 감사인이 검토·서명하여 확정해야 합니다.",
          italics: true,
        }),
      ],
    })
  );

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${data.companyName}_분석적검토조서_${data.generatedAt}.docx`);
}
