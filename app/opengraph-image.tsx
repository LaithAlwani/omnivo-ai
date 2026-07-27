import { ImageResponse } from "next/og";

// Static, brand-consistent social card. Rendered once at build time and reused
// for both Open Graph and Twitter (Next falls back to this when no twitter-image
// is present). Drawn with primitives so it stays self-contained — no asset fetch.
export const alt =
  "Omni AI — an AI assistant that chats, books, and captures leads";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(1200px 600px at 78% -10%, #1c1410 0%, #0c0a08 60%)",
          padding: "80px",
          color: "#ece4d8",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <div
            style={{
              width: "104px",
              height: "104px",
              borderRadius: "50%",
              border: "5px solid rgba(236,228,216,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle at 38% 32%, #FF8A52 0%, #F0522A 62%, #D93C16 100%)",
              }}
            />
          </div>
          <div
            style={{
              fontSize: "58px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Omni AI
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: "72px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              maxWidth: "900px",
            }}
          >
            An assistant that answers, books, and captures leads.
          </div>
          <div
            style={{
              fontSize: "30px",
              color: "#9c9184",
              maxWidth: "820px",
              lineHeight: 1.35,
            }}
          >
            Paste one snippet — a warm, on-brand AI goes live on your site in
            minutes.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
