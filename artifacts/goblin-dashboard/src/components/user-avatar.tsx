import { getAvatarPreset } from "@/lib/avatar-presets";

interface Props {
  presetId?: string | null;
  imageUrl?: string | null;
  fallbackText?: string;
  className?: string;
  emojiClass?: string;
}

export function UserAvatar({ presetId, imageUrl, fallbackText, className = "w-10 h-10", emojiClass = "text-xl" }: Props) {
  const preset = getAvatarPreset(presetId);
  if (preset) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-br ${preset.bg} border border-border flex items-center justify-center shrink-0`}>
        <span className={emojiClass}>{preset.emoji}</span>
      </div>
    );
  }
  if (imageUrl) {
    return <img src={imageUrl} alt="Avatar" className={`${className} rounded-full border border-border shrink-0 object-cover`} />;
  }
  return (
    <div className={`${className} rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground font-bold`}>
      {fallbackText?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}
