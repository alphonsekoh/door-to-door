import { type Back, BackLink } from "@/components/back-link";

type PageHeaderProps = {
  title: string;
  subtitle?: string | undefined;
  /* The screen this one was reached from. An installed iPhone app has no
     browser back button, so a child screen must offer its own way out. */
  back?: Back | undefined;
};

export function PageHeader({ title, subtitle, back }: PageHeaderProps) {
  return (
    <header className="mb-5">
      {back === undefined ? null : <BackLink {...back} />}
      <h1 className="text-heading font-semibold text-balance">{title}</h1>
      {subtitle ? <p className="mt-1 text-body text-foreground-muted">{subtitle}</p> : null}
    </header>
  );
}
