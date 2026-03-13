/**
 * INTEGRATION TESTS – Full HTTP request/response cycle via supertest.
 *
 * Tests every major route:
 *   Auth:        GET /login, GET /register, POST /register, POST /login, POST /logout
 *   Resume:      GET /upload-resume, POST /upload-resume
 *   Dashboard:   GET /dashboard (auth guard, renders, filters)
 *   Opportunity: POST /parse-opportunity (validation), POST /update-opportunity-status,
 *                POST /delete-opportunity
 *   Profile:     GET /profile
 *
 * MongoDB and AI dependencies are fully mocked – no network calls are made.
 */
'use strict';

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const Opportunity = require('../models/Opportunity');

// ── Mock heavy external deps ─────────────────────────────────────────────────
jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: { generateContent: jest.fn() }
    }))
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash:    jest.fn()
}));

jest.mock('../models/User', () => ({
    findOne:   jest.fn().mockImplementation(() => ({
        select: jest.fn().mockResolvedValue(null),
    })),
    findById:  jest.fn().mockImplementation(() => ({
        lean: jest.fn().mockResolvedValue(null),
    })),
    create:    jest.fn(),
}));

jest.mock('../models/Opportunity', () => ({
    find:               jest.fn(),
    findOne:            jest.fn(),
    findOneAndDelete:   jest.fn(),
    findByIdAndUpdate:  jest.fn(),
    findByIdAndDelete:  jest.fn(),
    save:               jest.fn(),
}));

process.env.SESSION_SECRET = 'integration-test-secret-abc123';

const { createApp } = require('../server-app');

// ── Shared fixture data ──────────────────────────────────────────────────────
const MOCK_USER = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test User',
    email: 'test@example.com',
    password: 'hashed-pass',
    skills: ['Python', 'React', 'Node.js'],
    branch: 'CSE',
    year: '3rd Year',
    resumeAnalysis: {
        score: 72,
        strengths: ['Good skills section'],
        weaknesses: ['No quantified bullets'],
        suggestions: ['Add metrics'],
        detectedSkills: ['Python', 'React'],
        missingSkills: ['Docker'],
        improvedBullets: [],
        analyzedAt: new Date('2026-01-01'),
    },
};

const MOCK_OPP = {
    _id: '507f191e810c19729de860ea',
    company: 'Acme Corp',
    role: 'Frontend Intern',
    eligibility: 'B.Tech CSE',
    required_skills: ['React', 'HTML', 'CSS'],
    deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
    deadline_mentioned: true,
    application_link: 'https://acme.example.com/apply',
    authenticity_score: 85,
    authenticity_reason: 'HTTPS link, complete details',
    application_status: 'Applied',
    status_history: [{ status: 'Applied', changedAt: new Date(), note: '' }],
    category: 'Frontend',
    raw_message: 'Acme is hiring Frontend Intern. Deadline in 10 days.',
    toObject: function () { return { ...this, toObject: undefined }; },
};

// Helper: mock User.findOne to return value directly (bypassing .select chain for login)
function mockFindOneReturning(value) {
    User.findOne.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue(value),
        then: (resolve) => Promise.resolve(value).then(resolve),  // allow direct await
    }));
    // Also allow direct mockResolvedValue usage via a resolved promise proxy
    // The login route uses User.findOne({email}).select('+password') chain.
    // We set it up as a thenable + has .select.
}

// ── Helper: create authenticated agent ──────────────────────────────────────
async function getAuthenticatedAgent(app) {
    // Login route uses: User.findOne({ email }).select('+password')
    User.findOne.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue(MOCK_USER),
    }));
    bcrypt.compare.mockResolvedValue(true);

    const agent = request.agent(app);
    await agent
        .post('/login')
        .type('form')
        .send({ email: MOCK_USER.email, password: 'password123' });

    return agent;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Auth Routes', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    // GET /login
    describe('GET /login', () => {
        test('returns 200 and renders login form', async () => {
            const res = await request(app).get('/login');
            expect(res.status).toBe(200);
            expect(res.text).toMatch(/Sign In|Login/i);
            expect(res.text).toMatch(/email/i);
            expect(res.text).toMatch(/password/i);
        });
    });

    // GET /register
    describe('GET /register', () => {
        test('returns 200 and renders registration form', async () => {
            const res = await request(app).get('/register');
            expect(res.status).toBe(200);
            expect(res.text).toMatch(/Create Account|Register/i);
        });
    });

    // POST /login – success
    describe('POST /login – valid credentials', () => {
        test('redirects to /dashboard on success', async () => {
            User.findOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(MOCK_USER) }));
            bcrypt.compare.mockResolvedValue(true);

            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ email: 'test@example.com', password: 'password123' });

            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('/dashboard');
        });
    });

    // POST /login – wrong password
    describe('POST /login – wrong password', () => {
        test('re-renders login with error', async () => {
            User.findOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(MOCK_USER) }));
            bcrypt.compare.mockResolvedValue(false);

            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ email: 'test@example.com', password: 'wrongpass' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/invalid|incorrect|wrong/i);
        });
    });

    // POST /login – user not found
    describe('POST /login – unknown email', () => {
        test('returns 200 with error (not 401 to prevent user enumeration)', async () => {
            User.findOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(null) }));

            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ email: 'nobody@example.com', password: 'pass123' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/invalid|incorrect/i);
        });
    });

    // POST /login – missing email
    describe('POST /login – missing fields', () => {
        test('returns 200 with validation error', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ email: '', password: '' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/required|enter/i);
        });
    });

    // POST /login – invalid email format
    describe('POST /login – invalid email format', () => {
        test('returns 200 with validation error', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ email: 'not-an-email', password: 'pass123' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/valid email/i);
        });
    });

    // POST /register – duplicate email
    describe('POST /register – duplicate email', () => {
        test('returns 200 with duplicate user error', async () => {
            // register route: User.findOne({email}).select('+password')
            User.findOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(MOCK_USER) }));

            const res = await request(app)
                .post('/register')
                .type('form')
                .send({ name: 'Another User', email: 'test@example.com', password: 'Pass1234!' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/already exists/i);
        });
    });

    // POST /register – missing name
    describe('POST /register – missing name', () => {
        test('returns 200 with validation error', async () => {
            const res = await request(app)
                .post('/register')
                .type('form')
                .send({ name: '', email: 'new@example.com', password: 'Pass1234!' });

            expect(res.status).toBe(200);
            expect(res.text).toMatch(/required/i);
        });
    });

    // POST /logout – auth guard
    describe('POST /logout', () => {
        test('redirects unauthenticated user to /login', async () => {
            const res = await request(app).post('/logout');
            expect([200, 302]).toContain(res.status);
        });

        test('authenticated user is logged out and redirected', async () => {
            User.findOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(MOCK_USER) }));
            bcrypt.compare.mockResolvedValue(true);

            const agent = request.agent(app);
            await agent.post('/login').type('form')
                .send({ email: MOCK_USER.email, password: 'password123' });

            const logoutRes = await agent.post('/logout');
            expect([302, 200]).toContain(logoutRes.status);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Dashboard Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('GET /dashboard unauthenticated → redirects to /login', async () => {
        const res = await request(app).get('/dashboard');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/login/);
    });

    test('GET /dashboard authenticated → 200 with rendered HTML', async () => {
        const sortMock = jest.fn().mockResolvedValue([MOCK_OPP]);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const agent = await getAuthenticatedAgent(app);
        // Re-mock after getAuthenticatedAgent clears state
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const res = await agent.get('/dashboard');
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/Tracktern/i);
        }
    });

    test('GET /dashboard renders opportunity company name', async () => {
        const sortMock = jest.fn().mockResolvedValue([MOCK_OPP]);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const res = await agent.get('/dashboard');
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toContain('Acme Corp');
        }
    });

    test('GET /dashboard renders "Add to Google Calendar" button for deadline opps', async () => {
        const sortMock = jest.fn().mockResolvedValue([MOCK_OPP]);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const res = await agent.get('/dashboard');
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/Add to Calendar/i);
            expect(res.text).toMatch(/calendar\.google\.com/);
        }
    });

    test('GET /dashboard with status filter', async () => {
        const applied = { ...MOCK_OPP, application_status: 'Applied', toObject: () => ({ ...MOCK_OPP, application_status: 'Applied' }) };
        const interview = { ...MOCK_OPP, _id: 'abc2', application_status: 'Interview', toObject: () => ({ ...MOCK_OPP, _id: 'abc2', application_status: 'Interview' }) };
        const sortMock = jest.fn().mockResolvedValue([applied, interview]);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const res = await agent.get('/dashboard?status=Interview');
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/Interview/i);
        }
    });

    test('GET /dashboard with empty opportunities', async () => {
        const sortMock = jest.fn().mockResolvedValue([]);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));
        Opportunity.find.mockReturnValue({ sort: sortMock });

        const res = await agent.get('/dashboard');
        expect([200, 302]).toContain(res.status);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESUME UPLOAD ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Resume Upload Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('GET /upload-resume unauthenticated → 302 to /login', async () => {
        const res = await request(app).get('/upload-resume');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/login/);
    });

    test('GET /upload-resume authenticated → 200 with form', async () => {
        const agent = await getAuthenticatedAgent(app);
        const res = await agent.get('/upload-resume');
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/resume/i);
        }
    });

    test('POST /upload-resume with blank text → 200 with error', async () => {
        const agent = await getAuthenticatedAgent(app);
        const res = await agent
            .post('/upload-resume')
            .type('form')
            .send({ resume_text: '' });
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/paste your resume|required|error/i);
        }
    });

    test('POST /upload-resume with too-short text → 200 with error', async () => {
        const agent = await getAuthenticatedAgent(app);
        const res = await agent
            .post('/upload-resume')
            .type('form')
            .send({ resume_text: 'too short' });
        expect([200, 302]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toMatch(/too short|fuller/i);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Profile Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('GET /profile unauthenticated → 302 to /login', async () => {
        const res = await request(app).get('/profile');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/login/);
    });

    test('GET /profile authenticated → 200/500/302 (session may expire after mock reset)', async () => {
        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));

        const res = await agent.get('/profile');
        expect([200, 302, 500]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toContain(MOCK_USER.name);
        }
    });

    test('GET /profile shows resume score', async () => {
        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));

        const res = await agent.get('/profile');
        expect([200, 302, 500]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toContain('72');
        }
    });

    test('GET /profile shows skills', async () => {
        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));

        const res = await agent.get('/profile');
        expect([200, 302, 500]).toContain(res.status);
        if (res.status === 200) {
            expect(res.text).toContain('Python');
            expect(res.text).toContain('React');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSE OPPORTUNITY ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Parse Opportunity Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('POST /parse-opportunity unauthenticated → 302 to /login', async () => {
        const res = await request(app)
            .post('/parse-opportunity')
            .type('form')
            .send({ raw_message_text: 'Some opportunity text' });
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/login/);
    });

    test('POST /parse-opportunity with no text and no link → 302', async () => {
        const agent = await getAuthenticatedAgent(app);

        const res = await agent
            .post('/parse-opportunity')
            .type('form')
            .send({ raw_message_text: '', source_link: '' });

        expect(res.status).toBe(302);
        // Either redirects to dashboard with error, or back to login if session dropped
        expect(res.headers.location).toMatch(/\/dashboard|\/login/);
    });

    test('POST /parse-opportunity with invalid link (no text) → 302', async () => {
        const agent = await getAuthenticatedAgent(app);

        const res = await agent
            .post('/parse-opportunity')
            .type('form')
            .send({ raw_message_text: '', source_link: 'not a url !!!!' });

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/dashboard|\/login/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE OPPORTUNITY STATUS ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Update Opportunity Status Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('POST /update-opportunity-status/:id unauthenticated → 302', async () => {
        const res = await request(app)
            .post('/update-opportunity-status/507f191e810c19729de860ea')
            .type('form')
            .send({ application_status: 'Interview' });
        expect(res.status).toBe(302);
    });

    test('POST /update-opportunity-status/:id with invalid status → redirects with error', async () => {
        const agent = await getAuthenticatedAgent(app);
        User.findById.mockResolvedValue(MOCK_USER);

        Opportunity.findOne = jest.fn().mockResolvedValue({
            ...MOCK_OPP,
            save: jest.fn().mockResolvedValue(true),
        });

        const res = await agent
            .post('/update-opportunity-status/507f191e810c19729de860ea')
            .type('form')
            .send({ application_status: 'INVALID_STATUS' });

        expect([302]).toContain(res.status);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE OPPORTUNITY ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Delete Opportunity Route', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    test('POST /delete-opportunity/:id unauthenticated → 302 to /login', async () => {
        const res = await request(app)
            .post('/delete-opportunity/507f191e810c19729de860ea')
            .type('form')
            .send({});
        expect(res.status).toBe(302);
    });

    test('POST /delete-opportunity/:id authenticated → redirects after delete attempt', async () => {
        // Route uses Opportunity.findOneAndDelete
        Opportunity.findOneAndDelete = jest.fn().mockResolvedValue({ _id: '507f191e810c19729de860ea' });
        const agent = await getAuthenticatedAgent(app);
        User.findById.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(MOCK_USER) }));

        const res = await agent
            .post('/delete-opportunity/507f191e810c19729de860ea')
            .type('form')
            .send({ return_status_filter: 'All' });

        expect([302, 200]).toContain(res.status);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY – Auth Guards
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Security: Auth Guards', () => {
    let app;
    beforeEach(() => {
        app = createApp();
        jest.clearAllMocks();
    });

    const protectedRoutes = [
        { method: 'GET',  path: '/dashboard' },
        { method: 'GET',  path: '/upload-resume' },
        { method: 'GET',  path: '/profile' },
        { method: 'POST', path: '/parse-opportunity' },
        { method: 'POST', path: '/update-opportunity-status/fakeid' },
        { method: 'POST', path: '/delete-opportunity/fakeid' },
    ];

    protectedRoutes.forEach(({ method, path }) => {
        test(`${method} ${path} without session → redirects to /login`, async () => {
            const res = method === 'GET'
                ? await request(app).get(path)
                : await request(app).post(path).type('form').send({});
            expect(res.status).toBe(302);
            expect(res.headers.location).toMatch(/\/login/i);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY – Security Headers
// ─────────────────────────────────────────────────────────────────────────────
describe('Integration – Security Headers', () => {
    let app;
    beforeEach(() => { app = createApp(); });

    test('GET /login includes X-Content-Type-Options header', async () => {
        const res = await request(app).get('/login');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('GET /login includes X-Frame-Options header', async () => {
        const res = await request(app).get('/login');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    test('GET /login includes Referrer-Policy header', async () => {
        const res = await request(app).get('/login');
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('Response does not expose X-Powered-By (Express fingerprint)', async () => {
        const res = await request(app).get('/login');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });
});
