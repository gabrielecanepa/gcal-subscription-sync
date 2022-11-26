// Dotenv
import * as dotenv from 'dotenv'
dotenv.config()

// Imports
import fetch from 'node-fetch'
import { parseString as parseIcs } from 'cal-parser'
import { auth as googleAuth, calendar as googleCalendar } from '@googleapis/calendar'
import { existsSync } from 'fs'

// Environment variables
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
const GOOGLE_CALENDAR_IDS = process.env.GOOGLE_CALENDAR_IDS.split(',')
const SUBSCRIPTION_URIS = process.env.SUBSCRIPTION_URIS.split(',')
const OVERRIDES_PATH = process.env.OVERRIDES_PATH || './overrides.js'

// Costants
const SCOPES = ['https://www.googleapis.com/auth/calendar']
const BASE32HEX_REGEXP = /([a-v]|[0-9])/g

// Variables
let overrides = {}

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
 * Format ICS start or end dates.
 *
 * @param {object} dtdate
 * @returns {object}
 */
const parseEventDate = dtdate => {
  const { value, params } = dtdate

  if (params.value === 'DATE') {
    return { date: value.toISOString().split('T')[0] }
  }

  return params.tzid ? { dateTime: value, timeZone: params.tzid } : { dateTime: value }
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
  const id = uid.value.match(BASE32HEX_REGEXP).join('')

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
 * Format a calendar events using the function specified in the ovveride file.
 *
 * @param {string} calendarId
 * @param {array} events
 * @returns {array}
 */
const transformEvents = (calendarId, events) => {
  const override = overrides[calendarId]
  if (!override) return events

  try {
    return override(events)
  } catch (e) {
    console.error(e)
    return events
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

for (const calendarId of GOOGLE_CALENDAR_IDS) {
  const i = GOOGLE_CALENDAR_IDS.indexOf(calendarId)

  try {
    if (existsSync(OVERRIDES_PATH)) {
      overrides = await (await import(OVERRIDES_PATH)).default
    }
  } catch {}

  try {
    const { data } = await client.events.list({ calendarId })
    const events = data.items

    const ics = await (await fetch(SUBSCRIPTION_URIS[i])).text()
    const icsEvents = parseIcs(ics).events.map(event => parseEvent(event))
    const icsEventsTransformed = transformEvents(calendarId, icsEvents)

    for (const icsEvent of icsEventsTransformed) {
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
