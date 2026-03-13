const request = require('supertest');
const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Opportunity = require('../models/Opportunity');
const { buildGoogleCalendarLink } = require('../lib/googleCalendar');

jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
            generateContent: jest.fn()
        }
    }))
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash: jest.fn()
}));

jest.mock('../models/User', () => ({
    findOne: jest.fn(),
    findById: jest.fn()
}));

jest.mock('../models/Opportunity', () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findByIdAndDelete: jest.fn()
}));

process.env.SESSION_SECRET = 'test-session-secret';

const { createApp } = require('../server-app');

describe('dashboard add to calendar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('buildGoogleCalendarLink creates a Google Calendar query-string URL', () => {
        const link = buildGoogleCalendarLink({
            company: 'Acme',
            role: 'Software Engineer Intern',
            deadline: new Date('2026-04-15T09:00:00.000Z'),
            application_link: 'https://jobs.example.com/apply'
        });

        const url = new URL(link);

        expect(`${url.origin}${url.pathname}`).toBe('https://calendar.google.com/calendar/render');
        expect(url.searchParams.get('action')).toBe('TEMPLATE');
        // New title format: '⏰ Apply by Today – {Company} {Role} Deadline'
        const text = url.searchParams.get('text');
        expect(text).toMatch(/Acme/);
        expect(text).toMatch(/Software Engineer Intern/);
        expect(text.toLowerCase()).toMatch(/deadline/);
        expect(url.searchParams.get('dates')).toBe('20260415T090000Z/20260415T100000Z');
        expect(url.searchParams.get('details')).toMatch(/Company.*Acme/s);
        expect(url.searchParams.get('details')).toMatch(/Role.*Software Engineer Intern/s);
        expect(url.searchParams.get('location')).toBe('https://jobs.example.com/apply');
    });

    test('dashboard renders an Add to Calendar button for valid deadlines', async () => {
        const user = {
            _id: '507f1f77bcf86cd799439011',
            name: 'Test User',
            email: 'test@example.com',
            password: 'hashed-password',
            skills: ['Node.js', 'Express'],
            branch: 'CSE',
            year: '3'
        };
        const opportunityData = {
            _id: '507f191e810c19729de860ea',
            company: 'Acme',
            role: 'Software Engineer Intern',
            eligibility: 'Open to CSE students',
            required_skills: ['Node.js'],
            deadline: new Date('2026-04-15T09:00:00.000Z'),
            deadline_mentioned: true,
            application_link: 'https://jobs.example.com/apply',
            raw_message: 'Acme is hiring. Deadline April 15, 2026.',
            authenticity_score: 92,
            authenticity_reason: 'Trusted application link and complete details'
        };
        const opportunityDoc = {
            ...opportunityData,
            toObject: () => ({ ...opportunityData })
        };
        const sort = jest.fn().mockResolvedValue([opportunityDoc]);

        User.findOne.mockResolvedValue(user);
        User.findById.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(true);
        Opportunity.find.mockReturnValue({ sort });

        const agent = request.agent(createApp());

        await agent
            .post('/login')
            .type('form')
            .send({ email: user.email, password: 'password123' })
            .expect(302)
            .expect('Location', '/dashboard');

        const response = await agent.get('/dashboard').expect(200);
        const $ = cheerio.load(response.text);
        const calendarButton = $('a').filter((_, element) => $(element).text().includes('Add to Calendar')).first();

        expect(calendarButton.length).toBe(1);
        // Calendar href should be a valid Google Calendar URL containing the company and role
        const href = calendarButton.attr('href');
        expect(href).toMatch(/calendar\.google\.com\/calendar\/render/);
        expect(href).toMatch(/Acme/);
        expect(href).toMatch(/action=TEMPLATE/);
        expect(sort).toHaveBeenCalledWith({ deadline: 1 });
    });
});
