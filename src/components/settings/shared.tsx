export function SectionHeading({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-[18px] font-semibold text-th-text-1">{title}</h3>
      {desc && <p className="text-[12.5px] text-th-text-3 mt-1">{desc}</p>}
    </div>
  );
}
