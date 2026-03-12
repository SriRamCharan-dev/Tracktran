const { normalizeDeadlineTime, extractDeadlineTime } = require('../lib/deadlineTime');

describe('deadline time helpers', () => {
    test('normalizes common deadline time formats', () => {
        expect(normalizeDeadlineTime('9 AM')).toBe('09:00');
        expect(normalizeDeadlineTime('09:30 PM')).toBe('21:30');
        expect(normalizeDeadlineTime('18:45')).toBe('18:45');
        expect(normalizeDeadlineTime('')).toBe('');
    });

    test('extracts a deadline time from opportunity text', () => {
        expect(extractDeadlineTime('Deadline: April 15, 2026 09:00 AM. Apply here.')).toBe('09:00');
        expect(extractDeadlineTime('Apply before 18:45 on 2026-04-15.')).toBe('18:45');
        expect(extractDeadlineTime('Deadline is April 15, 2026.')).toBe('');
    });
});
