// Dotenv
import * as dotenv from 'dotenv'
dotenv.config()

// Imports
import fetch from 'node-fetch'
import { auth as googleAuth, calendar as googleCalendar } from '@googleapis/calendar'
import { parseString as parseIcs } from 'cal-parser'

// Env variables
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
const SUBSCRIPTIONS = eval(process.env.SUBSCRIPTIONS)

if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !SUBSCRIPTIONS) {
  throw new Error(`Wrong environment variables. Rename the '.env.sample' file to '.env' and update the values.`)
}

// Constants
const SCOPES = ['https://www.googleapis.com/auth/calendar']
const BASE32HEX_REGEXP = /([a-v]|[0-9])/gi

const auth = new googleAuth.GoogleAuth({
  scopes: SCOPES,
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
})

const client = googleCalendar({
  version: 'v3',
  auth,
})

/**
 * Format ICS start or end date.
 *
 * @param {object} dtdate
 * @returns {object}
 */
const parseEventDate = dtdate => {
  const { value, params } = dtdate
  return params.value === 'DATE' ? { date: value.toISOString().split('T')[0] } : { dateTime: value }
}

/**
 * Format an ICS event as required by the Google Calendar API.
 *
 * @param {object} icsEvent
 * @returns {object}
 */
const parseEvent = event => {
  const { uid, summary, location, description, dtstart, dtend } = event

  // Convert UID to a base32hex ID as required by the Google Calendar API
  const id = uid.value.match(BASE32HEX_REGEXP).join('').toLowerCase()

  return {
    id,
    summary: summary.value,
    location: location.value,
    description: description.value,
    start: parseEventDate(dtstart),
    end: parseEventDate(dtend),
  }
}

/**
 * Check if an event is equal to another.
 *
 * @param {object} event
 * @param {object} eventToCompare
 * @returns {boolean}
 */
const isEqual = (a, b) => {
  return (
    a.summary === b.summary &&
    a.location === b.location &&
    a.description === b.description &&
    +new Date(a.start.dateTime) === +new Date(b.start.dateTime) &&
    a.start.timeZone === b.start.timeZone &&
    +new Date(a.end.dateTime) === new Date(b.end.dateTime) &&
    a.end.timeZone === b.end.timeZone
  )
}

for (const subscription of SUBSCRIPTIONS) {
  const { calendarId, url, fn = e => e } = subscription

  try {
    const { data } = await client.events.list({ calendarId })
    const events = data.items

    const ics = await (await fetch(url)).text()
    const icsEvents = parseIcs(ics).events.map(event => parseEvent(event))

    for (const icsEvent of fn(icsEvents)) {
      // Find the original event in the calendar
      const event = events.find(event => event.id === icsEvent.id)

      // Create event if not existing
      if (!event) {
        await client.events.insert({ calendarId, resource: icsEvent })
        continue
      }
      // Skip if equal
      if (isEqual(event, icsEvent)) continue
      // Update if not equal
      await client.events.update({ calendarId, eventId: event.id, resource: { ...event, ...icsEvent } })
    }
  } catch (e) {
    console.error(e)
  }
}
