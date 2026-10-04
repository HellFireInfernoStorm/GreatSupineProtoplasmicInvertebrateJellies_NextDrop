// Line icons for the Store screens, drawn like the Figma `store-icon/*` set: 24 px, 1.8 stroke, current colour.
const PATHS = {
  truck:
    "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  bag: "M6 8h12l1 12H5L6 8zM9 8V6.5a3 3 0 0 1 6 0V8",
  plus: "M12 5v14M5 12h14",
  route:
    "M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17.5h4.5a3 3 0 0 0 3-3v-1a3 3 0 0 1 2.5-3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20.5a2 2 0 0 0 4 0",
  repeat: "M4 12V9.5a3 3 0 0 1 3-3h11M15.5 3.5l3 3-3 3M20 12v2.5a3 3 0 0 1-3 3H6M8.5 20.5l-3-3 3-3",
  snow: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.8L12 6.5l2.5-1.7M9.5 19.2L12 17.5l2.5 1.7",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  send: "M4.5 11.5L20 4l-6 16-3.2-6.8-6.3-1.7z",
  chevronRight: "M9 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.3l2.4 2.4 4.6-5",
  flag: "M6 21V4M6 5h11l-2 4 2 4H6",
  minusCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8",
  refresh: "M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
