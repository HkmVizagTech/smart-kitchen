export function Emblem({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#e0701a" />
      <path
        d="M32 14c4 6 4 12 0 18-4-6-4-12 0-18Z"
        fill="#fff"
      />
      <path
        d="M32 20c6 3 9 8 9 15-7-1-11-5-13-11M32 20c-6 3-9 8-9 15 7-1 11-5 13-11"
        fill="#fff"
        fillOpacity="0.92"
      />
      <path
        d="M20 30c-3 6-2 12 3 16 3-5 3-11-3-16ZM44 30c3 6 2 12-3 16-3-5-3-11 3-16Z"
        fill="#fff"
        fillOpacity="0.8"
      />
      <path d="M16 46h32c-3 5-9 8-16 8s-13-3-16-8Z" fill="#d4a017" />
    </svg>
  );
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <>
      <img
        src="/logo.png"
        alt="logo"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = "flex";
        }}
      />
      <span style={{ display: "none", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <Emblem size={size} />
      </span>
    </>
  );
}
