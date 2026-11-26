export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand${compact ? " brand--compact" : ""}`}>
      <svg
        className="brand-mark"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <rect width="48" height="48" rx="13" fill="#3D7CFF" />
        <path
          d="M11 29V15l7 8 6-8v14M28 15v14m0-7 9-7m-9 7 9 7"
          stroke="white"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11 35c4-3 7 3 11 0s7 3 15 0"
          stroke="#BDD3FF"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="brand-wordmark">
        Моя Кинешма<span className="brand-tagline">ГОРОД. ЛЮДИ. СОБЫТИЯ.</span>
      </span>
    </span>
  );
}
