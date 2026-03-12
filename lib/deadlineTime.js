function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeadlineTime(value) {
    const rawValue = normalizeString(value);
    if (!rawValue) {
        return '';
    }

    const twentyFourHourMatch = rawValue.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if (twentyFourHourMatch) {
        return `${twentyFourHourMatch[1].padStart(2, '0')}:${twentyFourHourMatch[2]}`;
    }

    const meridiemMatch = rawValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!meridiemMatch) {
        return '';
    }

    let hours = Number(meridiemMatch[1]);
    const minutes = meridiemMatch[2] || '00';
    const meridiem = meridiemMatch[3].toLowerCase();

    if (!Number.isInteger(hours) || hours < 1 || hours > 12) {
        return '';
    }

    if (meridiem === 'am') {
        hours = hours === 12 ? 0 : hours;
    } else {
        hours = hours === 12 ? 12 : hours + 12;
    }

    return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function extractDeadlineTime(text) {
    const normalizedText = normalizeString(text);
    if (!normalizedText) {
        return '';
    }

    const candidates = [];
    const deadlineLineMatch = normalizedText.match(/deadline\s*[:\-]?\s*([^\n]+)/i);
    if (deadlineLineMatch && deadlineLineMatch[1]) {
        candidates.push(deadlineLineMatch[1].trim());
    }
    candidates.push(normalizedText);

    const patterns = [
        /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
        /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/
    ];

    for (const candidate of candidates) {
        for (const pattern of patterns) {
            const match = candidate.match(pattern);
            const normalizedTime = normalizeDeadlineTime(match && match[0]);
            if (normalizedTime) {
                return normalizedTime;
            }
        }
    }

    return '';
}

module.exports = {
    normalizeDeadlineTime,
    extractDeadlineTime
};
