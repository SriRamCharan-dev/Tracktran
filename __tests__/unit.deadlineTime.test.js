/**
 * UNIT TESTS – lib/deadlineTime.js
 * Tests normalizeDeadlineTime() and extractDeadlineTime() exhaustively.
 */
'use strict';

const { normalizeDeadlineTime, extractDeadlineTime } = require('../lib/deadlineTime');

// ─── normalizeDeadlineTime ─────────────────────────────────────────────────
describe('normalizeDeadlineTime', () => {
    describe('24-hour format', () => {
        test('normalizes "09:00" → "09:00"', () => {
            expect(normalizeDeadlineTime('09:00')).toBe('09:00');
        });
        test('normalizes "23:59" → "23:59"', () => {
            expect(normalizeDeadlineTime('23:59')).toBe('23:59');
        });
        test('pads single-digit hour: "9:30" → "09:30"', () => {
            expect(normalizeDeadlineTime('9:30')).toBe('09:30');
        });
        test('accepts HH:MM:SS and strips seconds: "14:30:00" → "14:30"', () => {
            expect(normalizeDeadlineTime('14:30:00')).toBe('14:30');
        });
        test('rejects invalid hour "24:00"', () => {
            expect(normalizeDeadlineTime('24:00')).toBe('');
        });
        test('rejects invalid minute "12:60"', () => {
            expect(normalizeDeadlineTime('12:60')).toBe('');
        });
    });

    describe('12-hour / am-pm format', () => {
        test('"11:30am" → "11:30"', () => {
            expect(normalizeDeadlineTime('11:30am')).toBe('11:30');
        });
        test('"12:00am" midnight → "00:00"', () => {
            expect(normalizeDeadlineTime('12:00am')).toBe('00:00');
        });
        test('"12:00pm" noon → "12:00"', () => {
            expect(normalizeDeadlineTime('12:00pm')).toBe('12:00');
        });
        test('"11:59pm" → "23:59"', () => {
            expect(normalizeDeadlineTime('11:59pm')).toBe('23:59');
        });
        test('"1pm" (no minutes) → "13:00"', () => {
            expect(normalizeDeadlineTime('1pm')).toBe('13:00');
        });
        test('"9 AM" (uppercase, space) → "09:00"', () => {
            expect(normalizeDeadlineTime('9 AM')).toBe('09:00');
        });
        test('"3:30 PM" → "15:30"', () => {
            expect(normalizeDeadlineTime('3:30 PM')).toBe('15:30');
        });
        test('rejects hour 13 in pm notation', () => {
            expect(normalizeDeadlineTime('13pm')).toBe('');
        });
    });

    describe('edge / invalid inputs', () => {
        test('empty string returns ""', () => {
            expect(normalizeDeadlineTime('')).toBe('');
        });
        test('null returns ""', () => {
            expect(normalizeDeadlineTime(null)).toBe('');
        });
        test('undefined returns ""', () => {
            expect(normalizeDeadlineTime(undefined)).toBe('');
        });
        test('random text returns ""', () => {
            expect(normalizeDeadlineTime('apply soon')).toBe('');
        });
    });
});

// ─── extractDeadlineTime ───────────────────────────────────────────────────
describe('extractDeadlineTime', () => {
    test('extracts time from "Deadline: 15 May 2026 at 11:59pm"', () => {
        expect(extractDeadlineTime('Deadline: 15 May 2026 at 11:59pm')).toBe('23:59');
    });

    test('extracts 24-h time from body text', () => {
        expect(extractDeadlineTime('Apply before 22:00 today')).toBe('22:00');
    });

    test('extracts time when it appears only on the deadline line', () => {
        const text = 'Company: Acme\nDeadline: April 30 2026 at 6pm\nEligibility: B.Tech';
        expect(extractDeadlineTime(text)).toBe('18:00');
    });

    test('returns "" when no time is embedded', () => {
        expect(extractDeadlineTime('Apply by April 30 2026')).toBe('');
    });

    test('returns "" for empty string', () => {
        expect(extractDeadlineTime('')).toBe('');
    });

    test('returns "" for null', () => {
        expect(extractDeadlineTime(null)).toBe('');
    });
});
