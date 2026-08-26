type PageHeaderProps = {
  title: string;
  subtitle?: string;
};

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="mb-5">
      <h1 className="text-heading font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle ? <p className="mt-1 text-body text-foreground-muted">{subtitle}</p> : null}
    </header>
  );
}
