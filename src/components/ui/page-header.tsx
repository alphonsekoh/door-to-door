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
  /* The title stands in for one the screen has yet to learn, as the block
     screen's does until the session answers. Held to one line, as a short
     block name is: two lines tall at large text, it gave one back as the
     block's name arrived, and the form jumped under a tap. */
  standIn?: boolean;
};

function WayBack({ back }: { back: Back | BackAction | undefined }) {
  if (back === undefined) return null;
  return "onBack" in back ? <BackButton {...back} /> : <BackLink {...back} />;
}

export function PageHeader({
  title,
  subtitle,
  back,
  inline = false,
  standIn = false,
}: PageHeaderProps) {
  const lines = standIn ? "truncate" : "text-balance break-words";
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
          <h1 className={`text-title font-semibold ${lines}`}>{title}</h1>
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
      {/* A session's title is whatever an admin typed, and a member's page
          is subtitled with their email: a long word breaks rather than push
          the screen sideways. */}
      <h1 className={`text-heading font-semibold ${lines}`}>{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-body break-words text-foreground-muted">{subtitle}</p>
      ) : null}
    </header>
  );
}
