import type { ReactNode } from 'react'

const base = (size: number, children: ReactNode, fill = 'none') => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
)
type P = { size?: number }

export const IconRss = ({ size = 20 }: P) => base(size, <><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></>)
/** Orang + gelombang radar */
export const IconPresence = ({ size = 18 }: P) => base(size, <><circle cx="9" cy="6" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" /><path d="M18 9a4 4 0 0 1 0 6" /><path d="M21 7a7 7 0 0 1 0 10" /></>)
export const IconPresenceOff = ({ size = 18 }: P) => base(size, <><circle cx="9" cy="6" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" /><path d="M18 11l2 2" strokeDasharray="1 3" /></>)
export const IconPie = ({ size = 18 }: P) => base(size, <><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M16 3.5A9 9 0 0 1 20.5 8H16z" /></>)
export const IconClock = ({ size = 18 }: P) => base(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const IconMoon = ({ size = 18 }: P) => base(size, <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />)
export const IconSun = ({ size = 18 }: P) => base(size, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const IconDownload = ({ size = 16 }: P) => base(size, <><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></>)
export const IconEye = ({ size = 18 }: P) => base(size, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
export const IconEyeOff = ({ size = 18 }: P) => base(size, <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1" /></>)
export const IconLock = ({ size = 14 }: P) => base(size, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>)
export const IconCheck = ({ size = 16 }: P) => base(size, <path d="m5 12 5 5 9-10" />)
export const IconX = ({ size = 16 }: P) => base(size, <path d="M6 6l12 12M18 6 6 18" />)
export const IconBolt = ({ size = 16 }: P) => base(size, <path d="M13 2 4 14h7l-1 8 9-12h-7z" />)
export const IconInfo = ({ size = 16 }: P) => base(size, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>)
export const IconDot = ({ size = 10, color = 'currentColor' }: P & { color?: string }) => <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden><circle cx="5" cy="5" r="4" fill={color} /></svg>
