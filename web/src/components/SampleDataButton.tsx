/**
 * "파일 없이 샘플 데이터로 체험하기" 버튼.
 *
 * 원래는 회색 텍스트 링크였는데, 심사위원·채용 담당자가 본인 엑셀 파일 없이
 * 기능을 볼 수 있는 유일한 경로인데도 눈에 안 띄어 그냥 지나치게 됐다.
 * 그래서 실제 업무 동작(파란색)과는 구분되는 초록 계열 배지로 만들어
 * "지금 눌러볼 수 있는 체험 경로"임이 드러나게 했다.
 */
export default function SampleDataButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-100 hover:shadow"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
      </svg>
      {label}
    </button>
  );
}
