import { icon } from "@/lib/art";
import { Svg } from "./Svg";

export function Icon({ name, className = "ico-inline", label }: { name: string; className?: string; label?: string }) {
  return <Svg svg={icon(name)} className={className} label={label} />;
}
