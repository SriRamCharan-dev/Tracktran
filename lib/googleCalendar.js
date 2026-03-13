/**
 * Google Calendar "Add to Calendar" link builder for Tracktern.
 *
 * Generates a pre-filled Google Calendar URL using the documented
 * calendar.google.com/calendar/render query-string API so the user
 * can add an internship deadline event with a single click.
 *
 * Query parameters used:
 *   action   – must be "TEMPLATE"
 *   text     – event title
 *   dates    – ISO-8601 compact form  YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
 *   details  – plain-text body (supports \n line breaks)
 *   location – event location / URL shown on the card
 *   trp      – "true" shows busy indicator
 *
 * Reference: https://support.google.com/calendar/thread/34681481
 */

'use strict';

/**
 * Format a Date into the compact ISO-8601 string Google Calendar expects:
 *   20260315T235900Z
 * We always output UTC so the event landing page shows it in the viewer's TZ.
 */
function toGCalDate(date) {
    return date.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/**
 * Build a rich Google Calendar "Add Event" link from an opportunity object.
 *
 * @param {Object} opp
 * @param {string}  opp.company
 * @param {string}  opp.role
 * @param {Date|string} opp.deadline        – deadline Date (or ISO string)
 * @param {string}  [opp.application_link]  – direct apply URL
 * @param {string}  [opp.eligibility]       – eligibility text
 * @param {string}  [opp.category]          – e.g. "Frontend", "Data/AI"
 * @param {string[]} [opp.required_skills]  – list of required skills
 * @param {number}  [opp.authenticity_score]
 * @returns {string}  Full Google Calendar URL, or '' if deadline is invalid.
 */
function buildGoogleCalendarLink(opp) {
    if (!opp) return '';

    // ── Resolve & validate the deadline ───────────────────────
    const deadline = opp.deadline instanceof Date
        ? opp.deadline
        : new Date(opp.deadline);

    if (!deadline || Number.isNaN(deadline.getTime())) return '';

    // ── Event window: deadline → deadline + 1 h ───────────────
    const endTime = new Date(deadline.getTime() + 60 * 60 * 1000);

    // ── Event title ────────────────────────────────────────────
    const company = (opp.company || 'Unknown Company').trim();
    const role    = (opp.role    || 'Internship').trim();
    const title   = `⏰ Apply by Today – ${company} ${role} Deadline`;

    // ── Event description / body ───────────────────────────────
    const descParts = [
        `📌 Internship Application Deadline`,
        ``,
        `Company : ${company}`,
        `Role    : ${role}`,
    ];

    if (opp.eligibility) {
        descParts.push(`Eligibility : ${opp.eligibility.slice(0, 200)}`);
    }

    if (opp.category) {
        descParts.push(`Category : ${opp.category}`);
    }

    if (Array.isArray(opp.required_skills) && opp.required_skills.length > 0) {
        descParts.push(`Skills Required : ${opp.required_skills.slice(0, 10).join(', ')}`);
    }

    if (opp.application_link) {
        descParts.push(``);
        descParts.push(`🔗 Apply here: ${opp.application_link}`);
    }

    descParts.push(``);
    descParts.push(`Added via Tracktern – AI Internship Intelligence Platform.`);

    const description = descParts.join('\n');

    // ── Build the URLSearchParams ──────────────────────────────
    const params = new URLSearchParams({
        action:   'TEMPLATE',
        text:     title,
        dates:    `${toGCalDate(deadline)}/${toGCalDate(endTime)}`,
        details:  description,
        trp:      'true',
    });

    // location shows as a clickable link on the Calendar event card
    if (opp.application_link) {
        params.set('location', opp.application_link);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { buildGoogleCalendarLink };
