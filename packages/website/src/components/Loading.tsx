/** Shown while a lazily loaded page (a docs page, the verification table, the changelog) is loading. */
export function Loading({ label }: { label: string }) {
  return (
    <div className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 text-sm text-muted-foreground sm:px-6" role="status">
      {label}
    </div>
  );
}
