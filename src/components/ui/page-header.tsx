import { type Back, type BackAction, BackButton, BackLink } from "@/components/ui/back-link";

type PageHeaderProps = {
  title: string;
  subtitle?: string | undefined;
  /* The screen this one was reached from. An installed iPhone app has no
     browser back button, so a child screen must offer its own way out. */
  back?: Back | BackAction | undefined;
  /* One row, as iOS titles a form: the way back, then the title centred
     with the subtitle under it. For a screen whose content has to start
     high, like the recording form above the pinned Save. */
  inline?: boolean;
};

function WayBack({ back }: { back: Back | BackAction | undefined }) {
  if (back === undefined) return null;
  return "onBack" in back ? <BackButton {...back} /> : <BackLink {...back} />;
}

export function PageHeader({ title, subtitle, back, inline = false }: PageHeaderProps) {
  if (inline) {
    return (
      /* The empty right column only centres the title: when the row is
         short of room it gives way first, so the title is never squeezed
         to nothing between two fixed columns. The way back keeps the room
         its chevron needs, or 44px, and no more: held at twice that at the
         largest text, it wrapped "Record a visit" onto a second line. */
      <header className="mb-3 grid min-h-11 grid-cols-[minmax(max(44px,--spacing(7)),1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-x-2">
        {/* A container, so the back label gives way to the chevron alone
            when large text leaves the title too little room. */}
        <div className="@container min-w-0">
          <WayBack back={back} />
        </div>
        <div className="min-w-0 text-center">
          <h1 className="text-title font-semibold text-balance break-words">{title}</h1>
          {subtitle ? (
            <p className="truncate text-caption text-foreground-muted">{subtitle}</p>
          ) : null}
        </div>
      </header>
    );
  }
  return (
    <header className="mb-5">
      <WayBack back={back} />
      {/* A session's title is whatever an admin typed: a long word breaks
          rather than push the screen sideways at large text. */}
      <h1 className="text-heading font-semibold text-balance break-words">{title}</h1>
      {subtitle ? <p className="mt-1 text-body text-foreground-muted">{subtitle}</p> : null}
    </header>
  );
}
