import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/**
 * Lightweight password strength scorer. Returns 0–4 plus a label so the
 * meter UI can color + describe consistently. Heuristic only — combines
 * length buckets with a character-class-variety bonus. Intentionally
 * doesn't pull in `zxcvbn` (~400KB) for a single dialog. Server-side
 * Clerk still runs the authoritative breach + strength checks.
 */
export function scorePasswordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: "Empty" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  if (classes >= 3) s++;
  if (pw.length < 6) s = 0;
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score]!;
  return { score, label };
}

const BAR_COLORS = [
  "bg-destructive",
  "bg-orange-500",
  "bg-amber-400",
  "bg-lime-500",
  "bg-emerald-500",
];
const LABEL_COLORS = [
  "text-destructive",
  "text-orange-400",
  "text-amber-400",
  "text-lime-400",
  "text-emerald-400",
];

export function PasswordStrengthMeter({ score, label }: PasswordStrength) {
  return (
    <div className="space-y-1" data-testid="password-strength-meter">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= score ? BAR_COLORS[score] : "bg-border/60",
            )}
          />
        ))}
      </div>
      <p className={cn("text-[11px]", LABEL_COLORS[score])}>{label}</p>
    </div>
  );
}

type InputProps = React.ComponentProps<typeof Input>;

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** When true, render the 0–4 strength meter under the input (auto-hidden when value is empty). */
  showStrength?: boolean;
  /** Override the test id on the toggle button. */
  toggleTestId?: string;
}

/**
 * Password input with a built-in show/hide eye toggle and an optional
 * strength meter. Drop-in replacement for `<Input type="password" />`.
 *
 * The eye button is keyboard-accessible (`type="button"` so it doesn't
 * accidentally submit forms) and leaves space on the right via `pr-10`.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ showStrength, toggleTestId, className, value, ...rest }, ref) {
    const [show, setShow] = React.useState(false);
    const stringValue = typeof value === "string" ? value : "";
    const strength = showStrength ? scorePasswordStrength(stringValue) : null;

    return (
      <div className="space-y-1.5">
        <div className="relative">
          <Input
            {...rest}
            ref={ref}
            value={value}
            type={show ? "text" : "password"}
            className={cn("pr-10", className)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            data-testid={toggleTestId ?? "button-toggle-password-visibility"}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {strength && stringValue.length > 0 && (
          <PasswordStrengthMeter score={strength.score} label={strength.label} />
        )}
      </div>
    );
  },
);
