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
      className="absolute top-2 right-2 z-[101] flex flex-col items-center gap-1.5 bg-card border border-border px-2.5 py-2.5 select-none transition-opacity duration-150 hover:opacity-0"
      style={{ width: 120 }}
    >
      <img
        src={identity.avatarUrl}
        alt=""
        className="object-cover"
        style={{ width: 80, height: 80, borderRadius: "50%" }}
        draggable={false}
      />
      <span
        className="font-bold text-foreground truncate max-w-full leading-tight"
        style={{ fontSize: 15 }}
      >
        {identity.displayName}
      </span>
      {identity.title && (
        <span
          className="text-muted-foreground truncate max-w-full leading-tight text-center"
          style={{ fontSize: 13 }}
        >
          {identity.title}
        </span>
      )}
    </div>
  );
}
