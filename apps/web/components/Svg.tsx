// Renders a trusted, locally generated SVG string (from @company/art or the fallback icons).
export function Svg({ svg, className, label }: { svg: string; className?: string; label?: string }) {
  return <span className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: svg }} />;
}
