/** The preview frame: the chapter's real page or slide when there is one, else a stylised screen. */
export function PlayerScreen({ scene, index, caption, image = null }: { scene: { title: string; focusZoom: boolean; redaction: boolean }; index: number; caption: string | null; image?: string | null }) {
  if (image) return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- an authorized API image, not a static asset */}
      <img className="slide" src={image} alt="" />
      <span className="chap">{scene.title}</span>
      {caption && <span className="cap">{caption.slice(0, 120)}</span>}
    </>
  );
  return (
    <>
      <div className="screen" aria-hidden>
        <div className="sb" />
        <div className="bd">
          <div className="ln" style={{ width: "40%", background: "#0B2D5B", opacity: 0.7 }} />
          <div className="ln" style={{ width: "85%" }} /><div className="ln" style={{ width: "70%" }} /><div className="ln" style={{ width: "55%" }} />
          {scene.redaction && <div className="ln blurbox" style={{ width: "45%" }} title="Redacted region" />}
        </div>
      </div>
      {scene.focusZoom && <span className="zoom" aria-hidden style={{ left: `${18 + ((index * 11) % 40)}%`, top: `${22 + ((index * 7) % 30)}%`, width: "34%", height: "30%" }} />}
      <span className="chap">{scene.title}</span>
      {caption && <span className="cap">{caption.slice(0, 120)}</span>}
    </>
  );
}
