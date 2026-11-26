export function RiverLines({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 640 240"
      fill="none"
      aria-hidden="true"
    >
      <path d="M-20 174C70 88 148 217 245 137S375 35 463 106s121 96 213-4" />
      <path d="M-20 190C70 104 148 233 245 153S375 51 463 122s121 96 213-4" />
      <path d="M-20 205C70 119 148 248 245 168S375 66 463 137s121 96 213-4" />
      <path d="M-20 220C70 134 148 263 245 183S375 81 463 152s121 96 213-4" />
      <path
        d="M-20 143C70 57 148 186 245 106S375 4 463 75s121 96 213-4"
        opacity=".5"
      />
      <path
        d="M-20 114C70 28 148 157 245 77S375-25 463 46s121 96 213-4"
        opacity=".25"
      />
    </svg>
  );
}
