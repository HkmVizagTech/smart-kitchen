// The app's mark: a bowl of hot food.
//
// It replaced a lamp flame, which said "temple" but not "kitchen", and which
// lost its shape below about 40px — the size it is actually drawn at in the
// header and on a phone's home screen. This one is three solid shapes and
// three strokes, so it survives being shrunk.
//
// The mark takes its colour from `currentColor`, so the same component serves
// the blue header logo and the white-on-blue app icon without a second copy.

export function Emblem({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
        <path d="M32 9c3.2 3 3.2 5.6 0 8.6s-3.2 5.6 0 8.6" />
        <path d="M22.5 15.5c2.3 2.2 2.3 4 0 6.2s-2.3 4 0 6.2" opacity="0.7" />
        <path d="M41.5 15.5c-2.3 2.2-2.3 4 0 6.2s2.3 4 0 6.2" opacity="0.7" />
      </g>
      <path d="M9.5 34h45c0 10.9-8.8 19.5-22.5 19.5S9.5 44.9 9.5 34Z" fill="currentColor" />
      <rect x="7" y="31" width="50" height="5.4" rx="2.7" fill="currentColor" />
    </svg>
  );
}

/** The header logo: a user-supplied `logo.png` if one is present, otherwise
 *  the built-in mark. Dropping a file into the web app's public folder is the
 *  whole of the branding story, which is why the fallback is silent. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <>
      <img
        src="/logo.png"
        alt=""
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = "flex";
        }}
      />
      <span
        style={{
          display: "none",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--primary)",
        }}
      >
        <Emblem size={size} />
      </span>
    </>
  );
}
