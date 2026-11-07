interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
}

/** Small on/off switch in the HUD's palette. Shared by the MCP and API tabs. */
export default function Toggle({ checked, onChange, title }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      title={title ?? (checked ? 'Disable' : 'Enable')}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full border transition-colors shrink-0 ${
        checked ? 'border-emerald-400/60 bg-emerald-400/20' : 'border-white/25 bg-white/5'
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full transition-all ${
          checked
            ? 'left-[17px] bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
            : 'left-[2px] bg-white/40'
        }`}
      />
    </button>
  );
}
