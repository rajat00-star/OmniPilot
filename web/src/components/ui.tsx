import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "../lib/format";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon: Icon, loading, children, className = "", disabled, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={14} /> : Icon ? <Icon size={size === "sm" ? 14 : 16} strokeWidth={2} aria-hidden /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={rest.title ?? label} {...rest}>
      <Icon size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function Badge({ tone = "neutral", children, icon: Icon }: { tone?: Tone; children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className={`badge tone-${tone}`}>
      {Icon && <Icon size={12} strokeWidth={2.25} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span className={`dot tone-${tone} ${pulse ? "pulse" : ""}`} aria-hidden />;
}

/** The loading indicator: a thin track with one orbiting arc, matching the core. */
export function Orbit({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="orbit" style={{ width: size, height: size }} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" className="orbit-track" />
        <circle cx="12" cy="12" r="9" className="orbit-arc" pathLength="100" />
      </svg>
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Orbit size={size} label="Loading" />;
}

export function SectionTitle({ children, action, count }: { children: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className="section-title">
      <h3>
        {children}
        {count !== undefined && <span className="count">{count}</span>}
      </h3>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** The OmniPilot mark: the core and two of its orbits. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <defs>
        <radialGradient id="op-logo-core" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#f4fbff" />
          <stop offset="38%" stopColor="#7fe6ff" />
          <stop offset="78%" stopColor="#2b6fe0" />
          <stop offset="100%" stopColor="#2b6fe0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13.5" ry="5" fill="none" stroke="#7fe6ff" strokeOpacity="0.8" strokeWidth="1.3" transform="rotate(-24 16 16)" />
      <ellipse cx="16" cy="16" rx="11.5" ry="3.6" fill="none" stroke="#9585ff" strokeOpacity="0.6" strokeWidth="1" transform="rotate(34 16 16)" />
      <circle cx="16" cy="16" r="6.4" fill="url(#op-logo-core)" />
    </svg>
  );
}
