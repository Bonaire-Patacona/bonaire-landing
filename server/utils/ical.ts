/**
 * Minimal iCalendar reader/writer for channel synchronisation.
 *
 * Airbnb, Booking.com and Vrbo all speak the same small dialect: all-day
 * VEVENTs with an exclusive DTEND. That is exactly the half-open range the rest
 * of the engine uses, so no conversion is needed. Only the subset those feeds
 * emit is implemented — no recurrence, no timezone database.
 */
import { toIsoDate } from './dates'

export interface IcsEvent {
  uid: string
  summary: string
  start: string // YYYY-MM-DD, inclusive
  end: string // YYYY-MM-DD, exclusive
  /** Deep link back to the channel, when the feed offers one. */
  link?: string
  raw?: string
}

/**
 * Whether an imported event is a stay somebody actually booked, or just a night
 * the channel is not selling.
 *
 * Only some feeds say. Airbnb writes 'Reserved' for a real reservation and
 * 'Airbnb (Not available)' for anything else — including the dates it closed
 * because it imported *our* calendar. Booking.com exports every busy night as
 * 'CLOSED - Not available' whatever the reason, so its reservations are simply
 * not distinguishable from its blocks.
 *
 * Hence the conservative default: 'closed' means "unavailable, reason not
 * disclosed", never "definitely not a booking".
 */
export type ExternalEventKind = 'reservation' | 'closed'

const RESERVATION_MARKERS = ['reserved', 'reservation', 'booked', 'reserva']

const URL_RE = /https?:\/\/[^\s<>"]+/

function firstUrl(text: string): string | undefined {
  return URL_RE.exec(text ?? '')?.[0]
}

export function classifyExternalEvent(summary: string): ExternalEventKind {
  const text = (summary ?? '').toLowerCase()

  // "CLOSED - Not available" and "Not available" win over a stray 'reserved':
  // a channel that says the night is merely closed is not claiming a booking.
  if (text.includes('not available') || text.includes('unavailable') || text.includes('closed')) {
    return 'closed'
  }
  return RESERVATION_MARKERS.some(marker => text.includes(marker)) ? 'reservation' : 'closed'
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/** RFC 5545 line unfolding: a leading space or tab continues the previous line. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

function parseIcsDate(value: string): string | null {
  const compact = value.trim()
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(compact)
  if (!match) return null
  const [, y, m, d] = match
  const iso = `${y}-${m}-${d}`
  return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: Partial<IcsEvent> & { lines?: string[] } | null = null

  for (const line of unfold(text)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = { lines: [] }
      continue
    }
    if (line.startsWith('END:VEVENT')) {
      if (current?.uid && current.start && current.end && current.end > current.start) {
        events.push({
          uid: current.uid,
          summary: current.summary || 'Blocked',
          start: current.start,
          end: current.end,
          link: current.link,
          raw: current.lines?.join('\n')
        })
      }
      current = null
      continue
    }
    if (!current) continue

    current.lines!.push(line)
    const sep = line.indexOf(':')
    if (sep === -1) continue

    const name = line.slice(0, sep).split(';')[0]!.toUpperCase()
    const value = line.slice(sep + 1)

    switch (name) {
      case 'UID':
        current.uid = value.trim()
        break
      case 'SUMMARY':
        current.summary = unescapeText(value)
        break
      // Airbnb puts "Reservation URL: https://..." here on real reservations
      // and leaves it out of its plain blocks. Booking.com never sends it.
      case 'DESCRIPTION':
        current.link = firstUrl(unescapeText(value)) ?? current.link
        break
      case 'DTSTART':
        current.start = parseIcsDate(value) ?? current.start
        break
      case 'DTEND':
        current.end = parseIcsDate(value) ?? current.end
        break
    }
  }

  return events
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** Folds a content line at 75 octets, as required by RFC 5545. */
function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line
  const chunks: string[] = []
  let current = ''
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > (chunks.length ? 74 : 75)) {
      chunks.push(current)
      current = char
    } else {
      current += char
    }
  }
  chunks.push(current)
  return chunks.map((chunk, i) => (i === 0 ? chunk : ` ${chunk}`)).join('\r\n')
}

const compact = (isoDate: string) => isoDate.replace(/-/g, '')

export interface BuildIcsOptions {
  name: string
  domain: string
  events: IcsEvent[]
}

export function buildIcs({ name, domain, events }: BuildIcsOptions): string {
  const stamp = `${toIsoDate(new Date()).replace(/-/g, '')}T000000Z`

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bonaire Patacona//Booking Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT1H'
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@${domain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(event.start)}`,
      `DTEND;VALUE=DATE:${compact(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    )
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
