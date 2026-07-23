export type AuditReportData = {
  companyName: string;
  sourceLabel: string;
  generatedAt: string;
  unit: string;
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

  return `
    <div class="report-root">
      <style>
        .report-root { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #0f172a; width: 760px; padding: 32px; background: #ffffff; }
        .report-root h1 { font-size: 22px; margin: 0 0 4px; }
        .report-root .meta { font-size: 12px; color: #64748b; margin-bottom: 24px; }
        .report-root h2 { font-size: 16px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #0f172a; }
        .report-root h3 { font-size: 13px; margin: 16px 0 6px; color: #334155; }
        .report-root table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
        .report-root th, .report-root td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        .report-root th { background: #f1f5f9; }
        .report-root .muted { font-size: 12px; color: #94a3b8; }
        .report-root ul { margin: 0 0 12px; padding-left: 18px; font-size: 12px; }
        .report-root .checklist-item { margin-bottom: 12px; font-size: 12px; }
        .report-root .checklist-item .risk { font-weight: 600; margin-bottom: 4px; }
        .report-root .checklist-item .isa { color: #1d4ed8; margin-top: 4px; }
      </style>
      <h1>${escapeHtml(data.companyName)} 감사조서</h1>
      <p class="meta">생성일: ${escapeHtml(data.generatedAt)} · 자료 출처: ${escapeHtml(data.sourceLabel)} · 금액 단위: ${escapeHtml(data.unit)}</p>

      <h2>1. 재무비율 분석</h2>
      ${ratioSections}

      <h2>2. 전기 대비 이상 변동 계정</h2>
      ${abnormalRows}

      <h2>3. 이상탐지 모델</h2>
      <p>Beneish M-Score: ${data.beneish ? `${escapeHtml(data.beneish.score)} (${escapeHtml(data.beneish.verdict)})` : "데이터 부족"}</p>
      <p>Altman Z&#39;-Score: ${data.altman ? `${escapeHtml(data.altman.score)} (${escapeHtml(data.altman.verdict)})` : "데이터 부족"}</p>
      <p>Benford&#39;s Law: ${data.benford ? `표본 ${data.benford.sampleSize}건 · 카이제곱 ${escapeHtml(data.benford.chiSquare)} — ${escapeHtml(data.benford.verdict)}` : "전표데이터 없음"}</p>
      <h3>RSF 테스트</h3>
      ${rsfRows}
      <h3>순환거래(라운드트립) 탐지</h3>
      ${roundTripRows}

      ${checklistSection}

      <p class="muted" style="margin-top: 24px;">본 리포트는 AI 기반 감사보조 분석 도구가 생성한 초안입니다. 최종 판단은 감사인이 직접 내려야 합니다.</p>
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
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${data.companyName}_감사조서_${data.generatedAt}.pdf`);
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

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      text: `${data.companyName} 감사조서`,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph(
      `생성일: ${data.generatedAt} · 자료 출처: ${data.sourceLabel} · 금액 단위: ${data.unit}`
    ),
    new Paragraph({ text: "1. 재무비율 분석", heading: HeadingLevel.HEADING_1 }),
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
      text: "2. 전기 대비 이상 변동 계정",
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
    new Paragraph({ text: "3. 이상탐지 모델", heading: HeadingLevel.HEADING_1 })
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
    children.push(new Paragraph(`순환거래 의심: ${f.detail}`))
  );

  if (data.checklist && data.checklist.length > 0) {
    children.push(
      new Paragraph({
        text: "4. 감사 체크리스트 (AI 초안)",
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

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "본 리포트는 AI 기반 감사보조 분석 도구가 생성한 초안입니다. 최종 판단은 감사인이 직접 내려야 합니다.",
          italics: true,
        }),
      ],
    })
  );

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${data.companyName}_감사조서_${data.generatedAt}.docx`);
}
