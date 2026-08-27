const HOME_PATH = "M3 10.5 12 3l9 7.5M5.25 9.75V21h13.5V9.75";

const PATHS: Record<string, string> = {
  "/": HOME_PATH,
  "/history": "M12 7v5l3.5 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8",
  "/follow-ups": "M4 5h16M4 12h10M4 19h7M17.5 16.5l2 2 4-4",
  "/admin/sessions": "M4 6h16M4 12h16M4 18h16M8.5 3.5v3M15.5 9v3M8.5 14.5v3",
  "/account": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0",
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name] ?? HOME_PATH} />
    </svg>
  );
}
