function formatGoogleCalendarDate(date) {
    return date.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function buildGoogleCalendarLink(opportunity) {
    const deadline = opportunity && opportunity.deadline instanceof Date
        ? opportunity.deadline
        : new Date(opportunity && opportunity.deadline);

    if (!opportunity || Number.isNaN(deadline.getTime())) {
        return '';
    }

    const endTime = new Date(deadline.getTime() + (60 * 60 * 1000));
    const titleParts = [opportunity.company, opportunity.role, 'deadline'].filter(Boolean);
    const descriptionLines = [
        opportunity.company ? `Company: ${opportunity.company}` : '',
        opportunity.role ? `Role: ${opportunity.role}` : '',
        opportunity.application_link ? `Apply: ${opportunity.application_link}` : ''
    ].filter(Boolean);

    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: titleParts.join(' '),
        dates: `${formatGoogleCalendarDate(deadline)}/${formatGoogleCalendarDate(endTime)}`,
        details: descriptionLines.join('\n')
    });

    if (opportunity.application_link) {
        params.set('location', opportunity.application_link);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = {
    buildGoogleCalendarLink
};
