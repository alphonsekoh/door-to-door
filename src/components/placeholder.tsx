type PlaceholderProps = {
  issue: number;
  children: string;
};

/* Temporary marker so the shell is navigable before the real screens land.
   Each one names the issue that replaces it. */
export function Placeholder({ issue, children }: PlaceholderProps) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5">
      <p className="text-body text-foreground-muted">{children}</p>
      <p className="mt-2 text-caption font-medium text-foreground-muted">
        Arrives in issue #{issue}
      </p>
    </div>
  );
}
