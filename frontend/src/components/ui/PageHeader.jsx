export default function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--primary)] mb-1.5">
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl md:text-[28px] leading-tight font-semibold tracking-[-0.02em] truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)] mt-2 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
