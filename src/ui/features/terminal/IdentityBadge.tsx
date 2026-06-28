import { useIdentities } from "@/state/identities-store";

export function IdentityBadge({
  identityKey,
}: {
  identityKey: string | null;
}) {
  const { byKey } = useIdentities();
  const identity = identityKey ? byKey.get(identityKey.toLowerCase()) : null;
  if (!identity) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute top-2 right-2 z-[101] flex flex-col items-center gap-1 bg-card border border-border px-2 py-2 select-none"
      style={{ pointerEvents: "none", width: 96 }}
    >
      <img
        src={identity.avatarUrl}
        alt=""
        className="w-16 h-16 object-cover"
        style={{ borderRadius: "50%" }}
        draggable={false}
      />
      <span className="text-xs font-bold text-foreground truncate max-w-full leading-tight">
        {identity.displayName}
      </span>
      {identity.title && (
        <span className="text-[10px] text-muted-foreground truncate max-w-full leading-tight text-center">
          {identity.title}
        </span>
      )}
    </div>
  );
}
