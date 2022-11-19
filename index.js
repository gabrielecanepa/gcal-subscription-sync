// Dotenv
import * as dotenv from 'dotenv'
dotenv.config()

// Imports
import fetch from 'node-fetch'
import ICalExpander from 'ical-expander'
import { auth as googleAuth, calendar as googleCalendar } from '@googleapis/calendar'

// Environment variables
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
const GOOGLE_CALENDAR_IDS = process.env.GOOGLE_CALENDAR_IDS
const SUBSCRIPTION_URIS = process.env.SUBSCRIPTION_URIS

const calendarsIds = GOOGLE_CALENDAR_IDS.split(',')
const subscriptionsUris = SUBSCRIPTION_URIS.split(',')

const SCOPES = ['https://www.googleapis.com/auth/calendar']

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

const parseEvent = event => {
  const { uid, summary, location, description, startDate, endDate } = event

  return {
    id: uid.split('@')[0],
    summary,
    location,
    description,
    start: { dateTime: startDate.toJSDate(), timeZone: 'UTC' },
    end: { dateTime: endDate.toJSDate(), timeZone: 'UTC' },
  }
}

const isEqual = (a, b) => {
  return (
    a.summary === b.summary &&
    a.location === b.location &&
    a.description === b.description &&
    +new Date(a.start.dateTime) === +new Date(b.start.dateTime) &&
    +new Date(a.end.dateTime) === new Date(b.end.dateTime)
  )
}

calendarsIds.forEach(async (calendarId, i) => {
  try {
    const { data } = await client.events.list({ calendarId })
    const events = data.items

    const ics = await (await fetch(subscriptionsUris[i])).text()
    const icsCalendar = new ICalExpander({ ics }).all()
    const icsEvents = icsCalendar.events.map(e => parseEvent(e))

    for (const icsEvent of icsEvents) {
      const event = events.find(event => event.id === icsEvent.id)

      // Create event if not existing
      if (!event) {
        await client.events.insert({ calendarId, resource: icsEvent })
        continue
      }
      // Return if equal
      if (isEqual(event, icsEvent)) continue
      // Update if not equal
      await client.events.update({ calendarId, eventId: event.id, resource: { ...event, ...icsEvent } })
    }
  } catch (e) {
    console.error(e)
  }
})
