import Link from "next/link";

// The Omni AI mark: a machined ring with a molten core — the engine running hot.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="Omni AI home"
    >
      <span className="relative inline-flex h-8 w-8 items-center justify-center">
        <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
          <defs>
            <radialGradient id="core" cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#FF8A52" />
              <stop offset="62%" stopColor="#F0522A" />
              <stop offset="100%" stopColor="#D93C16" />
            </radialGradient>
          </defs>
          <circle
            cx="16"
            cy="16"
            r="14.4"
            fill="none"
            stroke="rgba(236,228,216,0.28)"
            strokeWidth="1.6"
          />
          {/* machined ticks */}
          {Array.from({ length: 24 }).map((_, i) => (
            <line
              key={i}
              x1="16"
              y1="1.6"
              x2="16"
              y2="4.6"
              stroke="rgba(236,228,216,0.32)"
              strokeWidth="0.9"
              transform={`rotate(${i * 15} 16 16)`}
            />
          ))}
          <circle
            cx="16"
            cy="16"
            r="7.2"
            fill="url(#core)"
            className="origin-center transition-transform duration-500 group-hover:scale-110"
          />
        </svg>
      </span>
      <span className="font-display text-[1.35rem] leading-none tracking-tight text-bone">
        Omni&nbsp;AI
      </span>
    </Link>
  );
}
