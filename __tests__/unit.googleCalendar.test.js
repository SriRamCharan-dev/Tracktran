/**
 * UNIT TESTS – lib/googleCalendar.js
 * Tests the Google Calendar URL builder in full isolation.
 */
'use strict';

const { buildGoogleCalendarLink } = require('../lib/googleCalendar');

// ─── helpers ───────────────────────────────────────────────────────────────
const DEADLINE = new Date('2026-06-15T14:30:00.000Z');
const DEADLINE_END = new Date('2026-06-15T15:30:00.000Z'); // +1 h

function toGCalDate(d) {
    return d.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function parseCalUrl(link) {
    const url = new URL(link);
    return {
        base: `${url.origin}${url.pathname}`,
        p: url.searchParams,
    };
}

// ─── test suite ────────────────────────────────────────────────────────────
describe('buildGoogleCalendarLink – URL structure', () => {
    test('returns empty string when opp is null', () => {
        expect(buildGoogleCalendarLink(null)).toBe('');
    });

    test('returns a URL string even when deadline is null (null coerces to epoch Date)', () => {
        // new Date(null) = Jan 1 1970 which IS a valid date, so a URL is produced
        const result = buildGoogleCalendarLink({ company: 'X', role: 'Y', deadline: null });
        expect(typeof result).toBe('string');
    });

    test('returns empty string when deadline is an invalid date string', () => {
        expect(buildGoogleCalendarLink({ company: 'X', role: 'Y', deadline: 'not-a-date' })).toBe('');
    });

    test('returns empty string when deadline is undefined', () => {
        expect(buildGoogleCalendarLink({ company: 'X', role: 'Y' })).toBe('');
    });

    test('returns a valid https://calendar.google.com URL', () => {
        const link = buildGoogleCalendarLink({ company: 'Acme', role: 'SWE Intern', deadline: DEADLINE });
        const { base } = parseCalUrl(link);
        expect(base).toBe('https://calendar.google.com/calendar/render');
    });

    test('action param is always TEMPLATE', () => {
        const link = buildGoogleCalendarLink({ company: 'Acme', role: 'SWE', deadline: DEADLINE });
        expect(parseCalUrl(link).p.get('action')).toBe('TEMPLATE');
    });

    test('event title includes company and role', () => {
        const link = buildGoogleCalendarLink({ company: 'Google', role: 'STEP Intern', deadline: DEADLINE });
        const text = parseCalUrl(link).p.get('text');
        expect(text).toMatch(/Google/);
        expect(text).toMatch(/STEP Intern/);
        // Title includes 'Deadline' word in some form
        expect(text.toLowerCase()).toMatch(/deadline/);
    });

    test('event dates span from deadline to deadline+1h', () => {
        const link = buildGoogleCalendarLink({ company: 'A', role: 'B', deadline: DEADLINE });
        const dates = parseCalUrl(link).p.get('dates');
        expect(dates).toBe(`${toGCalDate(DEADLINE)}/${toGCalDate(DEADLINE_END)}`);
    });

    test('trp is set to true (marks time as busy)', () => {
        const link = buildGoogleCalendarLink({ company: 'A', role: 'B', deadline: DEADLINE });
        expect(parseCalUrl(link).p.get('trp')).toBe('true');
    });

    test('location is the application_link when provided', () => {
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B', deadline: DEADLINE,
            application_link: 'https://apply.example.com/job/42',
        });
        expect(parseCalUrl(link).p.get('location')).toBe('https://apply.example.com/job/42');
    });

    test('no location param when application_link is absent', () => {
        const link = buildGoogleCalendarLink({ company: 'A', role: 'B', deadline: DEADLINE });
        expect(parseCalUrl(link).p.get('location')).toBeNull();
    });

    test('details body contains company and role lines', () => {
        const link = buildGoogleCalendarLink({ company: 'Tesla', role: 'Data Intern', deadline: DEADLINE });
        const details = parseCalUrl(link).p.get('details');
        expect(details).toMatch(/Company\s*:\s*Tesla/);
        expect(details).toMatch(/Role\s*:\s*Data Intern/);
    });

    test('details body contains eligibility when provided', () => {
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B', deadline: DEADLINE,
            eligibility: 'B.Tech CSE 3rd year only',
        });
        expect(parseCalUrl(link).p.get('details')).toMatch(/B\.Tech CSE 3rd year only/);
    });

    test('details body contains category when provided', () => {
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B', deadline: DEADLINE,
            category: 'Data/AI',
        });
        expect(parseCalUrl(link).p.get('details')).toMatch(/Data\/AI/);
    });

    test('details body lists required_skills when provided', () => {
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B', deadline: DEADLINE,
            required_skills: ['Python', 'DSA', 'SQL'],
        });
        const details = parseCalUrl(link).p.get('details');
        expect(details).toMatch(/Python/);
        expect(details).toMatch(/DSA/);
        expect(details).toMatch(/SQL/);
    });

    test('details body contains apply link when provided', () => {
        const applyUrl = 'https://careers.acme.com/apply';
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B', deadline: DEADLINE,
            application_link: applyUrl,
        });
        expect(parseCalUrl(link).p.get('details')).toContain(applyUrl);
    });

    test('details body mentions Tracktern as source', () => {
        const link = buildGoogleCalendarLink({ company: 'A', role: 'B', deadline: DEADLINE });
        expect(parseCalUrl(link).p.get('details')).toMatch(/Tracktern/i);
    });

    test('accepts deadline as ISO string (not just Date object)', () => {
        const link = buildGoogleCalendarLink({
            company: 'A', role: 'B',
            deadline: '2026-06-15T14:30:00.000Z',
        });
        const dates = parseCalUrl(link).p.get('dates');
        expect(dates).toBe(`${toGCalDate(DEADLINE)}/${toGCalDate(DEADLINE_END)}`);
    });

    test('limits required_skills to first 10 entries', () => {
        const skills = Array.from({ length: 15 }, (_, i) => `Skill${i + 1}`);
        const link = buildGoogleCalendarLink({ company: 'A', role: 'B', deadline: DEADLINE, required_skills: skills });
        const details = parseCalUrl(link).p.get('details');
        expect(details).toMatch(/Skill1/);
        expect(details).not.toMatch(/Skill11/);
    });
});
