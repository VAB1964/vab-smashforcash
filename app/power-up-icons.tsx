import { useId, type CSSProperties } from "react";
import type { ActionId } from "../shared/engine";

export type PowerUpId = Extract<ActionId, "lockdown" | "steal" | "good" | "shield">;

const TITLES: Record<PowerUpId, string> = {
  lockdown: "Lockdown",
  steal: "Steal",
  good: "Greater Good",
  shield: "Shield",
};

export function PowerUpIcon({ type, size = 48, title }: { type: PowerUpId; size?: number; title?: string | false }) {
  const gradientId = useId().replace(/:/g, "");
  const accessibleTitle = title === false ? undefined : title ?? TITLES[type];
  return <svg className={`power-up-icon power-up-icon-${type}`} width={size} height={size} viewBox="0 0 64 64" role={accessibleTitle ? "img" : undefined} aria-hidden={accessibleTitle ? undefined : true} aria-label={accessibleTitle}>
    <defs>
      <linearGradient id={gradientId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
        <stop stopColor="currentColor" stopOpacity=".98"/>
        <stop offset="1" stopColor="currentColor" stopOpacity=".5"/>
      </linearGradient>
    </defs>
    {type === "lockdown" && <>
      <path className="icon-back" d="M14 27 19 10h26l5 17-5 27H19z"/>
      <path d="M23 28v-7a9 9 0 0 1 18 0v7M20 28h24v22H20z" fill={`url(#${gradientId})`}/>
      <path d="M32 34v9m-4-5h8" className="icon-cut"/>
      <path d="M12 17h7M45 17h7M9 23l8 2m30 0 8-2" className="icon-spark"/>
    </>}
    {type === "steal" && <>
      <path className="icon-back" d="M9 39c5-14 13-23 23-23s18 9 23 23l-8 15H17z"/>
      <path d="M17 31c4-10 9-15 15-15s11 5 15 15c-9-4-21-4-30 0Z" fill={`url(#${gradientId})`}/>
      <path d="M20 34c7-4 17-4 24 0v14c-7 5-17 5-24 0Z" fill={`url(#${gradientId})`}/>
      <path d="M24 37h6l-2 6h-6Zm16 0h-6l2 6h6ZM28 49l4-3 4 3" className="icon-cut"/>
      <path d="m13 22 7 3m31-3-7 3" className="icon-spark"/>
    </>}
    {type === "good" && <>
      <path className="icon-back" d="M32 55C15 45 9 36 12 25c3-11 16-12 20-3 4-9 17-8 20 3 3 11-3 20-20 30Z"/>
      <path d="M32 51C17 42 13 34 16 26c2-7 11-8 16 1 5-9 14-8 16-1 3 8-1 16-16 25Z" fill={`url(#${gradientId})`}/>
      <path d="M12 35c7 0 10 3 14 8m26-8c-7 0-10 3-14 8" className="icon-spark"/>
      <path d="M32 30v13m-6-7h12" className="icon-cut"/>
    </>}
    {type === "shield" && <>
      <path className="icon-back" d="m32 7 22 9v15c0 14-8 23-22 28C18 54 10 45 10 31V16z"/>
      <path d="m32 12 17 7v12c0 11-6 18-17 23-11-5-17-12-17-23V19z" fill={`url(#${gradientId})`}/>
      <path d="M32 17v31m-12-8 12 8 12-8" className="icon-cut"/>
      <path d="m9 11 7 4m39-4-7 4M6 24l7 1m38 0 7-1" className="icon-spark"/>
    </>}
  </svg>;
}

export function PowerUpMeter({ type, progress, size = 70, label }: { type: PowerUpId; progress: number; size?: number; label?: string }) {
  const value = Math.max(0, Math.min(1, progress));
  return <span className={`power-up-meter meter-${type}`} style={{ "--meter-progress": `${value * 360}deg`, "--meter-size": `${size}px` } as CSSProperties} role={label ? "progressbar" : undefined} aria-label={label} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined} aria-valuenow={label ? Math.round(value * 100) : undefined}>
    <span className="power-up-meter-core"><PowerUpIcon type={type} size={Math.round(size * .62)} title={false}/></span>
  </span>;
}
