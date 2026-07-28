export default function LoadingDots({ text }: { text: string }) {
  return (
    <span>
      {text}
      <span className="loading-dots ml-0.5 inline-flex">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  );
}
