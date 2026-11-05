/**
 * Writing iCalendar (RFC 5545) for the calendar feed (calendar.ts): just what a subscribed calendar needs. Times are
 * written in UTC, so no time zone has to be described; all-day entries are the school's own dates.
 */

export type IcsEvent = {
  uid: string;
  summary: string;
  /** ISO instants, or a school day (YYYY-MM-DD) for an all-day entry, which ends the day after. */
  start: string;
  end: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  /** A link to open it at. */
  url?: string | null;
};

/** Text with the characters RFC 5545 treats as structure escaped. */
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const date = (day: string) => day.replace(/-/g, "");

const enc = new TextEncoder();

/** A content line folded at 75 octets, continuation lines starting with a space, never splitting a character. */
function fold(line: string) {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function calendar(opts: { name: string; zone: string; events: IcsEvent[]; now: number }) {
  const stamp = utc(new Date(opts.now).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Compass Neo//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(opts.name)}`,
    `X-WR-TIMEZONE:${opts.zone}`,
    // Calendar apps that honour these come back hourly; most choose for themselves.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${escape(e.uid)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${date(e.start)}`, `DTEND;VALUE=DATE:${date(e.end)}`, "TRANSP:TRANSPARENT");
    else lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
    lines.push(`SUMMARY:${escape(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
